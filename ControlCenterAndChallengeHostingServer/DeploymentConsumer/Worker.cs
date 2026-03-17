using DeploymentConsumer.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.RabbitMQ;
using ResourceShared.Models;
using ResourceShared.Utils;
using RestSharp;
using System.Text.Json;
using static ResourceShared.Enums;

namespace DeploymentConsumer;

internal class Worker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<Worker> _logger;
    private readonly RedisHelper _redisHelper;
    private readonly MultiServiceConnector _multiServiceConnector;

    public Worker(
        IServiceScopeFactory scopeFactory,
        ILogger<Worker> logger,
        RedisHelper redisHelper,
        MultiServiceConnector multiServiceConnector)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _redisHelper = redisHelper;
        _multiServiceConnector = multiServiceConnector;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessAsync(stoppingToken);
                await Task.Delay(TimeSpan.FromSeconds(DeploymentConsumerConfigHelper.WORKER_POLL_INTERVAL_SECONDS), stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in DeploymentConsumer Worker");
                await Task.Delay(TimeSpan.FromSeconds(DeploymentConsumerConfigHelper.WORKER_POLL_INTERVAL_SECONDS), stoppingToken);
            }
        }
    }

    private async Task ProcessAsync(CancellationToken stoppingToken)
    {
        using var workerScope = _scopeFactory.CreateScope();
        var workerDbContext = workerScope.ServiceProvider.GetRequiredService<AppDbContext>();
        var argoService = workerScope.ServiceProvider.GetRequiredService<IArgoWorkflowService>();
        var queueService = workerScope.ServiceProvider.GetRequiredService<IDeploymentConsumerService>();

        var runningWorkflow = await argoService.GetRunningWorkflowsCountAsync(stoppingToken);

        _logger.LogInformation($"[Worker] Current running workflows: {runningWorkflow}");
        if (runningWorkflow >= DeploymentConsumerConfigHelper.MAX_RUNNING_WORKFLOW)
        {
            _logger.LogInformation($"[Worker] Skipping this batch as running workflows exceed limit ({DeploymentConsumerConfigHelper.MAX_RUNNING_WORKFLOW})");
            return;
        }
        var availableSlots = DeploymentConsumerConfigHelper.MAX_RUNNING_WORKFLOW - runningWorkflow;
        List<DequeuedMessage> messages = await queueService.DequeueAvailableBatchAsync(Math.Min(availableSlots, DeploymentConsumerConfigHelper.BATCH_SIZE));

        _logger.LogInformation($"[Worker] Dequeued {messages.Count} messages for processing");

        var headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_TOKEN}" };

        foreach (var mess in messages)
        {
            _logger.LogInformation($"[Worker] Excuting message with tag {mess.DeliveryTag}");

            var startReq = JsonSerializer.Deserialize<ChallengeStartStopReqDTO>(mess.Payload.Data);
            if (startReq == null)
            {
                _logger.LogError("Invalid payload");
                continue;
            }

            var deploymentKey = ChallengeHelper.GetCacheKey(startReq.challengeId, startReq.teamId);
            var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);
            // create new scope for db context
            using var messageScope = _scopeFactory.CreateScope();
            var messageDbContext = messageScope.ServiceProvider.GetRequiredService<AppDbContext>();
            try
            {
                if (deploymentCache == null) throw new InvalidOperationException("Deployment cache not found");

                var challenge = await messageDbContext.Challenges
                    .FirstOrDefaultAsync(c => c.Id == startReq.challengeId, cancellationToken: stoppingToken)
                    ?? throw new InvalidOperationException($"Challenge {startReq.challengeId} not found");

                var jsonImageLink = challenge.ImageLink
                    ?? throw new InvalidOperationException("Challenge image link is null");

                var imageObj = JsonSerializer.Deserialize<ChallengeImageDTO>(jsonImageLink)
                    ?? throw new InvalidOperationException($"Unable to deserialize ChallengeImageDTO for Challenge ID: {challenge.Id}.");

                var cpuLimit = (challenge.CpuLimit ?? 0) > 0 ? challenge.CpuLimit!.Value : 300;
                var cpuRequest = (challenge.CpuRequest ?? 0) > 0 ? challenge.CpuRequest!.Value : cpuLimit;
                var memoryLimit = (challenge.MemoryLimit ?? 0) > 0 ? challenge.MemoryLimit!.Value : 256;
                var memoryRequest = (challenge.MemoryRequest ?? 0) > 0 ? challenge.MemoryRequest!.Value : memoryLimit;
                var useGvisor = challenge.UseGvisor ?? true;
                var hardenContainer = challenge.HardenContainer ?? true;

                var cpuLimitValue = $"{cpuLimit}m";
                var cpuRequestValue = $"{cpuRequest}m";
                var memoryLimitValue = $"{memoryLimit}Mi";
                var memoryRequestValue = $"{memoryRequest}Mi";

                var (payload, appName) = ChallengeHelper.BuildArgoPayload(
                    challenge,
                    startReq.teamId,
                    imageObj,
                    cpuLimitValue,
                    cpuRequestValue,
                    memoryLimitValue,
                    memoryRequestValue,
                    useGvisor,
                    hardenContainer,
                    DeploymentConsumerConfigHelper.POD_START_TIMEOUT_MINUTES);

                var response = await _multiServiceConnector.ExecuteRequest(
                    DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_URL,
                    "/submit",
                    Method.Post,
                    payload,
                    headers)
                    ?? throw new InvalidOperationException("No response from Argo Workflows API");

                // lấy workflow name từ response
                string workflowName = string.Empty;
                if (!string.IsNullOrEmpty(response))
                {
                    using var doc = JsonDocument.Parse(response);
                    workflowName = doc.RootElement
                        .GetProperty("metadata")
                        .GetProperty("name")
                        .GetString()!;

                    await queueService.AckAsync(mess.DeliveryTag);
                    _logger.LogInformation("Request send to argo. ChallengeId={ChallengeId}, TeamId={TeamId}, WorkflowName={WorkflowName}", startReq.challengeId, startReq.teamId, workflowName);
                    if (string.IsNullOrWhiteSpace(workflowName))
                        throw new InvalidOperationException("Workflow name is empty");
                }
                deploymentCache._namespace = appName;
                deploymentCache.status = DeploymentStatus.PENDING;
                deploymentCache.workflow_name = workflowName;
                deploymentCache.time_finished = 0;


                await _redisHelper.AtomicUpdateExpiration(
                    startReq?.teamId.ToString() ?? string.Empty,
                    deploymentKey,
                    startReq?.challengeId.ToString() ?? string.Empty,
                    realTtlSeconds: DeploymentConsumerConfigHelper.ARGO_DEPLOY_TTL_MINUTES * 60,
                    JsonSerializer.Serialize(deploymentCache));
            }
            catch (Exception ex)
            {
                await queueService.NackAsync(mess.DeliveryTag);
                _logger.LogError(ex, "Deploy failed. ChallengeId={ChallengeId}, TeamId={TeamId}", startReq.challengeId, startReq.teamId);
            }
        }
    }
}

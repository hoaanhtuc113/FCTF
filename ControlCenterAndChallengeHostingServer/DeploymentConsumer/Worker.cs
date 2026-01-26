using DeploymentConsumer.Models;
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
using SocialSync.Shared.Utils.ResourceShared.Utils;
using System.Text.Json;
using static ResourceShared.Enums;

namespace DeploymentConsumer;

internal class Worker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<Worker> _logger;
    private readonly RedisHelper _redisHelper;

    private const int BatchSize = 20;
    private const int MaxRunningWorkFlow = 30;
    public Worker(IServiceScopeFactory scopeFactory, ILogger<Worker> logger, RedisHelper redisHelper)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _redisHelper = redisHelper;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessAsync(stoppingToken);
                await Task.Delay(TimeSpan.FromSeconds(8), stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in DeploymentConsumer Worker");
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
        if (runningWorkflow >= MaxRunningWorkFlow)
        {
            _logger.LogInformation($"[Worker] Skipping this batch as running workflows exceed limit ({MaxRunningWorkFlow})");
            return;
        }
        var availableSlots = MaxRunningWorkFlow - runningWorkflow;
        List<DequeuedMessage> messages = await queueService.DequeueAvailableBatchAsync(Math.Min(availableSlots,BatchSize));

        _logger.LogInformation($"[Worker] Dequeued {messages.Count} messages for processing");

        var headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_TOKEN}" };

        var api = DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_URL + "/submit";

        MultiServiceConnector multiServiceConnector = new(api);

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
            using var messageScope = _scopeFactory.CreateScope();
            var messageDbContext = messageScope.ServiceProvider.GetRequiredService<AppDbContext>();
            try
            {
                var challenge = await messageDbContext.Challenges
                    .FirstOrDefaultAsync(c => c.Id == startReq.challengeId, cancellationToken: stoppingToken)
                    ?? throw new InvalidOperationException($"Challenge {startReq.challengeId} not found");

                var jsonImageLink = challenge.ImageLink
                    ?? throw new InvalidOperationException("Challenge image link is null");

                var imageObj = JsonSerializer.Deserialize<ChallengeImageDTO>(jsonImageLink)
                    ?? throw new InvalidOperationException($"Unable to deserialize ChallengeImageDTO for Challenge ID: {challenge.Id}.");

                var (payload, appName) = ChallengeHelper.BuildArgoPayload(
                        challenge,
                        startReq.teamId,
                        imageObj,
                        DeploymentConsumerConfigHelper.CPU_LIMIT,
                        DeploymentConsumerConfigHelper.CPU_REQUEST,
                        DeploymentConsumerConfigHelper.MEMORY_LIMIT,
                        DeploymentConsumerConfigHelper.MEMORY_REQUEST,
                        DeploymentConsumerConfigHelper.POD_START_TIMEOUT_MINUTES);


                var response = await multiServiceConnector.ExecuteRequest(api, Method.Post, payload, headers)
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

                var deploymentCache = new ChallengeDeploymentCacheDTO
                {
                    challenge_id = startReq?.challengeId ?? 0,
                    user_id = startReq?.userId ?? 0,
                    team_id = startReq?.teamId ?? 0,
                    _namespace = appName,
                    workflow_name = workflowName ?? string.Empty,
                    status = DeploymentStatus.PENDING,
                    time_finished = 0
                };

                await _redisHelper.AtomicUpdateExpiration(
                    startReq?.teamId.ToString() ?? string.Empty,
                    deploymentKey,
                    startReq?.challengeId.ToString() ?? string.Empty,
                    realTtlSeconds: 300,
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

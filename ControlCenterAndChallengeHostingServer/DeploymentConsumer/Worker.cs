using DeploymentConsumer.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.RabbitMQ;
using ResourceShared.Logger;
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
    private readonly AppLogger _appLogger;
    private readonly RedisHelper _redisHelper;
    private readonly MultiServiceConnector _multiServiceConnector;
    private readonly WorkerHeartbeat _heartbeat;

    public Worker(
        IServiceScopeFactory scopeFactory,
        ILogger<Worker> logger,
        AppLogger appLogger,
        RedisHelper redisHelper,
        MultiServiceConnector multiServiceConnector,
        WorkerHeartbeat heartbeat)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _appLogger = appLogger;
        _redisHelper = redisHelper;
        _multiServiceConnector = multiServiceConnector;
        _heartbeat = heartbeat;
    }

    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(60);
    private int _consecutiveFailures = 0;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessAsync(stoppingToken);
                _heartbeat.Ping();
                _consecutiveFailures = 0;
                await Task.Delay(TimeSpan.FromSeconds(DeploymentConsumerConfigHelper.WORKER_POLL_INTERVAL_SECONDS), stoppingToken);
            }
            catch (Exception ex)
            {
                _appLogger.LogError(ex, data: new { context = "WorkerLoop" });
                _heartbeat.Ping();
                _consecutiveFailures++;

                // Exponential backoff on repeated failures instead of hammering
                // Argo/K8s at a fixed interval while they're already struggling.
                var backoff = TimeSpan.FromSeconds(
                    DeploymentConsumerConfigHelper.WORKER_POLL_INTERVAL_SECONDS * Math.Pow(2, Math.Min(_consecutiveFailures, 8)));
                var delay = backoff < MaxRetryDelay ? backoff : MaxRetryDelay;

                await Task.Delay(delay, stoppingToken);
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

        var headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {DeploymentConsumerConfigHelper.GetArgoWorkflowsBearerToken()}" };

        foreach (var mess in messages)
        {
            // Each message carries the id of the request that enqueued it, so the
            // work done for it is logged under that id rather than under whatever
            // the previous message in the batch happened to leave behind.
            CorrelationContext.Current = mess.CorrelationId;

            _logger.LogInformation("[Worker] Executing message with tag {DeliveryTag}. CorrelationId={CorrelationId}",
                mess.DeliveryTag, mess.CorrelationId);

            // Deserialized and validated by DeploymentConsumerService when the
            // message came off the queue; anything that failed there was nacked
            // there and never reached this batch.
            var startReq = mess.Request;

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

                // Resolve the flag from the challenge's own rows instead of from the
                // message: a static flag's content, or the team's dynamic flag, minted
                // here on first deploy. This value is interpolated into the challenge
                // manifest by the Argo template, and the queue is the one hop into this
                // service that something other than deployment-center could reach - a
                // flag arriving in the payload would be a caller-chosen string landing
                // in a rendered manifest. Null is normal (no flag, regex flag, or a
                // shared instance with only a dynamic flag) and BuildArgoPayload then
                // omits CHALLENGE_FLAG entirely.
                var flagValue = await ChallengeHelper.ResolveDeploymentFlagAsync(
                    messageDbContext,
                    startReq.challengeId,
                    startReq.teamId,
                    stoppingToken);

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
                    DeploymentConsumerConfigHelper.POD_START_TIMEOUT_MINUTES,
                    flagValue,
                    mess.CorrelationId);

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
                    _logger.LogInformation("Request send to argo. ChallengeId={ChallengeId}, TeamId={TeamId}, WorkflowName={WorkflowName}, CorrelationId={CorrelationId}", startReq.challengeId, startReq.teamId, workflowName, mess.CorrelationId);
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
                _appLogger.LogError(
                    ex,
                    startReq.userId,
                    startReq.teamId,
                    new { challengeId = startReq.challengeId },
                    correlationId: mess.CorrelationId,
                    contestId: startReq.contestId);
            }
        }
    }
}

using DeploymentConsumer.Models;
using DeploymentConsumer.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ResourceShared.DTOs.Challenge;
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
                await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
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

        var runningWorkflow = await argoService.GetRunningWorkflowsCountAsync(stoppingToken);

        _logger.LogInformation($"[Worker] Current running workflows: {runningWorkflow}");
        if (runningWorkflow >= MaxRunningWorkFlow)
        {
            _logger.LogInformation($"[Worker] Skipping this batch as running workflows exceed limit ({MaxRunningWorkFlow})");
            return;
        }
        var availableSlots = MaxRunningWorkFlow - runningWorkflow;
        List<ArgoOutbox> jobs;
        try
        {
            var take = Math.Max(0, Math.Min(availableSlots, BatchSize));

            jobs = await workerDbContext.ArgoOutboxes
            .Where(x =>
                x.Expiry > DateTime.UtcNow &&
                (
                    x.Status == (int)ArgoOutboxStatus.Pending ||
                    (x.Status == (int)ArgoOutboxStatus.Failed && x.RetryCount < 3) ||
                    (x.Status == (int)ArgoOutboxStatus.Processing &&
                        x.ProcessingAt < DateTime.UtcNow.AddMinutes(-5))
                )
            )
            .OrderBy(x => x.CreatedAt)
            .Take(take)
            .ToListAsync(stoppingToken);

            _logger.LogInformation($"[Worker] Fetched {jobs.Count} jobs from ArgoOutbox.");
        }
        catch (Exception ex)
        {
            _logger.LogCritical("Cannot connect to Database. Skipping this batch.");
            return;
        }

        var headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_TOKEN}" };

        var api = DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_URL + "/submit";

        MultiServiceConnector multiServiceConnector = new(api);

        foreach (var job in jobs)
        {
            var claimed = await workerDbContext.ArgoOutboxes
                .Where(x => x.Id == job.Id &&
                       (
                           x.Status == (int)ArgoOutboxStatus.Pending ||
                           x.Status == (int)ArgoOutboxStatus.Failed ||
                           (x.Status == (int)ArgoOutboxStatus.Processing &&
                            x.ProcessingAt < DateTime.UtcNow.AddMinutes(-5))
                       ))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.Status, (int)ArgoOutboxStatus.Processing)
                    .SetProperty(x => x.ProcessingAt, DateTime.UtcNow)
                    .SetProperty(x => x.RetryCount, x => x.RetryCount + 1),
                    stoppingToken);

            _logger.LogInformation($"[Worker] Claimed job ID {job.Id}, rows affected: {claimed}");

            if (claimed == 0)
                continue; // job đã bị worker khác hoặc vòng khác claim


            var startReq = JsonSerializer.Deserialize<ChallengeStartStopReqDTO>(job.Payload);
            if (startReq == null)
            {
                _logger.LogError("Invalid payload in ArgoOutbox with ID {Id}", job.Id);
                continue;
            }

            var deploymentKey = ChallengeHelper.GetCacheKey(startReq.challengeId, startReq.teamId);
            using var jobScope = _scopeFactory.CreateScope();
            var jobDbContext = jobScope.ServiceProvider.GetRequiredService<AppDbContext>();
            try
            {
                var challenge = await jobDbContext.Challenges
                    .FirstOrDefaultAsync(c => c.Id == startReq.challengeId, cancellationToken: stoppingToken)
                    ?? throw new InvalidOperationException($"Challenge {startReq.challengeId} not found");

                var jsonImageLink = challenge.ImageLink
                    ?? throw new InvalidOperationException("Challenge image link is null");

                var imageObj = JsonSerializer.Deserialize<ChallengeImageDTO>(jsonImageLink)
                    ?? throw new InvalidOperationException("Unable to deserialize ChallengeImageDTO for Challenge ID {ChallengeId}.");

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

                    if (string.IsNullOrWhiteSpace(workflowName))
                        throw new InvalidOperationException("Workflow name is empty");
                }

                await jobDbContext.ArgoOutboxes
                    .Where(x => x.Id == job.Id)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(x => x.Status, (int)ArgoOutboxStatus.Completed)
                        .SetProperty(x => x.WorkflowName, workflowName),
                        stoppingToken);

                var deploymentCache = new ChallengeDeploymentCacheDTO
                {
                    challenge_id = startReq.challengeId,
                    user_id = startReq?.userId ?? 0,
                    team_id = startReq?.teamId ?? 0,
                    _namespace = appName,
                    workflow_name = workflowName ?? string.Empty,
                    status = DeploymentStatus.PENDING,
                    time_finished = 0
                };

                await _redisHelper.SetCacheAsync(deploymentKey, deploymentCache, TimeSpan.FromMinutes(2));

            }
            catch (Exception ex)
            {
                await jobDbContext.ArgoOutboxes
                    .Where(x => x.Id == job.Id)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(x => x.Status, (int)ArgoOutboxStatus.Failed),
                        stoppingToken);

                await _redisHelper.RemoveCacheAsync(deploymentKey);

                _logger.LogError(ex,
                    "Deploy failed. ChallengeId={ChallengeId}, TeamId={TeamId}",
                    startReq.challengeId, startReq.teamId);
            }
        }
    }
}

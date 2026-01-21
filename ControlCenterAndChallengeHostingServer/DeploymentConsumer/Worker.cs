using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using System.Net;
using System.Text.Json;
using static ResourceShared.Enums;

namespace DeploymentConsumer;

internal class Worker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<Worker> _logger;
    private readonly RedisHelper _redisHelper;
    private const int BatchSize = 20;

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
            await ProcessAsync(stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(25), stoppingToken);
        }
    }

    private async Task ProcessAsync(CancellationToken stoppingToken)
    {
        using var workerScope = _scopeFactory.CreateScope();
        var workerBbContext = workerScope.ServiceProvider.GetRequiredService<AppDbContext>();

        List<ArgoOutbox> jobs = await workerBbContext.ArgoOutboxes
            .Where(x => x.Status == (int)ArgoOutboxStatus.Pending)
            .Where(x => x.Expiry > DateTime.UtcNow)
            .OrderBy(x => x.CreatedAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken: stoppingToken);

        var headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_TOKEN}" };

        var api = DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_URL + "/submit";

        MultiServiceConnector multiServiceConnector = new(api);

        foreach (var job in jobs)
        {
            var startReq = JsonSerializer.Deserialize<ChallengeStartStopReqDTO>(job.Payload);
            if (startReq == null)
            {
                _logger.LogError("Invalid payload in ArgoOutbox with ID {Id}", job.Id);
                continue;
            }

            var deploymentKey = ChallengeHelper.GetCacheKey(startReq.challengeId, startReq.teamId);

            var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);
            try
            {
                using var jobScope = _scopeFactory.CreateScope();
                var jobDbContext = jobScope.ServiceProvider.GetRequiredService<AppDbContext>();

                var challenge = await jobDbContext.Challenges
                    .FirstOrDefaultAsync(c => c.Id == startReq.challengeId, cancellationToken: stoppingToken);
                if (challenge == null)
                {
                    _logger.LogError("Challenge with ID {ChallengeId} not found.", startReq.challengeId);
                    continue;
                }

                var jsonImageLink = challenge.ImageLink;
                if (jsonImageLink == null)
                {
                    _logger.LogError("Challenge image link is null for Challenge ID {ChallengeId}.", startReq.challengeId);
                    continue;
                }

                var imageObj = JsonSerializer.Deserialize<ChallengeImageDTO>(jsonImageLink);
                if (imageObj == null)
                {
                    _logger.LogError("Unable to deserialize ChallengeImageDTO for Challenge ID {ChallengeId}.", startReq.challengeId);
                    continue;
                }

                var (payload, appName) = ChallengeHelper.BuildArgoPayload(
                        challenge,
                        startReq.teamId,
                        imageObj,
                        DeploymentConsumerConfigHelper.CPU_LIMIT,
                        DeploymentConsumerConfigHelper.CPU_REQUEST,
                        DeploymentConsumerConfigHelper.MEMORY_LIMIT,
                        DeploymentConsumerConfigHelper.MEMORY_REQUEST,
                        DeploymentConsumerConfigHelper.POD_START_TIMEOUT_MINUTES);


                var response = await multiServiceConnector.ExecuteRequest(api, Method.Post, payload, headers);
                if (response == null)
                {
                    _logger.LogError("No response from Argo Workflows API");
                    continue;
                }

                // lấy workflow name từ response
                string? workflowName = null;
                if (!string.IsNullOrEmpty(response))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(response);
                        workflowName = doc.RootElement
                            .GetProperty("metadata")
                            .GetProperty("name")
                            .GetString();
                    }
                    catch
                    {
                        _logger.LogError("Unable to parse workflow name from response.");
                    }
                }

                deploymentCache = new ChallengeDeploymentCacheDTO
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
                job.Status = (int)ArgoOutboxStatus.Completed;
                await jobDbContext.SaveChangesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                await _redisHelper.RemoveCacheAsync(deploymentKey);
                _logger.LogError(ex, null, startReq.teamId, new { startReq.challengeId });
                continue;
            }
        }
    }
}

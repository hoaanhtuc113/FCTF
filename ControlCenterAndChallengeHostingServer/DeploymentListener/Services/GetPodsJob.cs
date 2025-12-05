using DeploymentListener.Utils;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ResourceShared.Configs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Models;
using ResourceShared.Services;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using static ResourceShared.Enums;

namespace DeploymentListener.Services
{
    public interface IGetPodsJob
    {
        Task RunAsync(CancellationToken ct);
        Task StartWatchingAsync(CancellationToken ct);
    }

    public class GetPodsJob : IGetPodsJob
    {
        private readonly IK8sService _k8SHealthService;
        private readonly RedisHelper _redisHelper;
        private readonly IServiceScopeFactory _scopeFactory;
        public GetPodsJob(IK8sService k8SHealthService, RedisHelper redisHelper, IServiceScopeFactory scopeFactory)
        {
            _redisHelper = redisHelper;
            _k8SHealthService = k8SHealthService;
            _scopeFactory = scopeFactory;
        }

        public Task RunAsync(CancellationToken ct)
        {
            throw new NotImplementedException();
        }

        public async Task StartWatchingAsync(CancellationToken ct)
        {
            await Console.Out.WriteLineAsync("GetPodsJob (Watcher Mode) is starting...");

            OnDeploymentStatusChanged statusHandler = async (teamId, challengeId, userId, status, url) =>
            {
                if (teamId <= 0)
                {
                    await Console.Out.WriteLineAsync($"[SignalR] Not User, skipping notification.");
                    return;
                }
                using (var scope = _scopeFactory.CreateScope())
                {
                    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                    try
                    {
                        var challenge = await dbContext.Challenges.AsNoTracking().FirstOrDefaultAsync(c => c.Id == challengeId);
                        var challengeName = challenge?.Name ?? "Unknown Challenge";
                        var timeLimit = challenge?.TimeLimit ?? -1;

                        var message = status switch
                        {
                            DeploymentStatus.RUNING => "Challenge deployed successfully.",
                            DeploymentStatus.FAILED => "Your challenge was deployed unsuccessfully.",
                            DeploymentStatus.STOPPED => "Challenge deployment has been stopped.",
                            _ => ""
                        };

                        //var deploymentEvent = new DeploymentEventDTO
                        //{
                        //    EventType = status,
                        //    ChallengeId = challengeId,
                        //    ChallengeName = challengeName,
                        //    TeamId = teamId,
                        //    UserId = userId,
                        //    Message = message,
                        //    ChallengeUrl = url ?? "",
                        //    TimeLimit = timeLimit,
                        //};

                        //await Console.Out.WriteLineAsync($"[SignalR] Sending {status} to team-{teamId}");

                        //MultiServiceConnector multiServiceConnector = new MultiServiceConnector(DeploymentListenerConfigHelper.CONTESTANT_BE_API);
                        //var headers = new Dictionary<string, string> { { "X-Internal-Key", DeploymentListenerConfigHelper.PRIVATE_KEY } };

                        //await Console.Out.WriteLineAsync($"[Internal API] Pushing deployment to {DeploymentListenerConfigHelper.CONTESTANT_BE_API}/api/internal/push");
                        //var result = await multiServiceConnector.ExecuteRequest(
                        //    "/api/internal/push",
                        //    Method.Post,
                        //    deploymentEvent,
                        //    headers
                        //);

                        //await Console.Out.WriteLineAsync($"[Internal API] Deployment event pushed for team-{teamId}, response: {result}");
                    }
                    catch (Exception ex)
                    {
                        await Console.Error.WriteLineAsync($"[Handler Error] {ex.Message}");
                    }
                }
            };

            await _k8SHealthService.StartPodWatcher(statusHandler, cancellationToken: ct);
        }
    }
}
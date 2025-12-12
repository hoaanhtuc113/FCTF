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
using ResourceShared.Logger;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using static ResourceShared.Enums;

namespace DeploymentListener.Services
{
    public interface IGetPodsJob
    {
        Task StartWatchingAsync(CancellationToken ct);
    }

    public class GetPodsJob : IGetPodsJob
    {
        private readonly IK8sService _k8SHealthService;
        private readonly RedisHelper _redisHelper;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly AppLogger _logger;
        public GetPodsJob(IK8sService k8SHealthService, RedisHelper redisHelper, IServiceScopeFactory scopeFactory, AppLogger logger)
        {
            _redisHelper = redisHelper;
            _k8SHealthService = k8SHealthService;
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        public async Task StartWatchingAsync(CancellationToken ct)
        {

            OnDeploymentStatusChanged statusHandler = async (teamId, challengeId, userId, status, url) =>
            {
                if (teamId <= 0)
                {
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

                        Console.WriteLine($"[Watcher] Challenge {challengeName} (ID: {challengeId}) for Team {teamId} changed status to {status}");
                        var message = status switch
                        {
                            DeploymentStatus.RUNING => "Challenge deployed successfully.",
                            DeploymentStatus.FAILED => "Your challenge was deployed unsuccessfully.",
                            DeploymentStatus.STOPPED => "Challenge deployment has been stopped.",
                            _ => ""
                        };
                      
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, null, teamId, new { challengeId });
                        await Console.Error.WriteLineAsync($"[Handler Error] {ex.Message}");
                    }
                }
            };

            await _k8SHealthService.StartPodWatcher(statusHandler, cancellationToken: ct);
        }
    }
}
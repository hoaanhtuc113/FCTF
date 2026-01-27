using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Services;
using static ResourceShared.Enums;

namespace DeploymentListener;

public class Worker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IK8sService _k8SHealthService;
    private readonly AppLogger _logger;

    public Worker(
        AppLogger logger,
        IServiceScopeFactory scopeFactory,
        IK8sService k8SHealthService)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _k8SHealthService = k8SHealthService;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await StartWatchingAsync(stoppingToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex);
        }
    }

    public async Task StartWatchingAsync(CancellationToken ct)
    {

        async Task statusHandler(int teamId, int challengeId, int userId, string status, string? url = null)
        {
            if (teamId <= 0) return;

            using var scope = _scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            try
            {
                var challenge = await dbContext.Challenges
                    .AsNoTracking()
                    .FirstOrDefaultAsync(c => c.Id == challengeId, cancellationToken: ct);

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
            }
        }

        await _k8SHealthService.StartPodWatcher(statusHandler, cancellationToken: ct);
    }
}

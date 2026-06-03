using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Services;
using ResourceShared.Utils;

namespace DeploymentListener;

public class ContestEndCleanupService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IK8sService _k8sService;
    private readonly RedisHelper _redisHelper;
    private readonly AppLogger _logger;
    private long _lastCleanedCtfEnd = 0;

    public ContestEndCleanupService(
        IServiceScopeFactory scopeFactory,
        IK8sService k8sService,
        RedisHelper redisHelper,
        AppLogger logger)
    {
        _scopeFactory = scopeFactory;
        _k8sService = k8sService;
        _redisHelper = redisHelper;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CheckAndCleanupAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, data: new { errorType = "ContestEndCleanupError" });
            }
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }

    private async Task CheckAndCleanupAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var configHelper = new ConfigHelper(dbContext);

        var ctfEnd = configHelper.GetConfig<long>("end", 0);
        if (ctfEnd <= 0) return;

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (now <= ctfEnd) return;

        // Already cleaned up for this specific contest end time
        if (_lastCleanedCtfEnd == ctfEnd) return;

        _logger.LogDebug($"[ContestEndCleanup] Contest ended at unix={ctfEnd}. Stopping all challenge instances...");

        var (successCount, failCount, errors) = await _k8sService.DeleteAllChallengeNamespaces("ctf/kind=challenge");
        await _redisHelper.RemoveCacheByPattern("deploy_challenge_*");
        await _redisHelper.RemoveCacheByPattern("active_deploys_team_*");

        _lastCleanedCtfEnd = ctfEnd;

        _logger.LogDebug($"[ContestEndCleanup] Done. Stopped {successCount} namespace(s), {failCount} failed." +
            (errors.Count > 0 ? $" Errors: {string.Join("; ", errors)}" : ""));
    }
}

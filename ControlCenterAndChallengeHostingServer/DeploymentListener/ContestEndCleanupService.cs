using Microsoft.EntityFrameworkCore;
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
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

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
        _logger.LogDebug("ContestEndCleanupService started", new { intervalSeconds = Interval.TotalSeconds });

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CheckAndCleanupEndedContestsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, data: new { errorType = "ContestEndCleanupTickError" });
            }

            await Task.Delay(Interval, stoppingToken);
        }
    }

    private async Task CheckAndCleanupEndedContestsAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var now = DateTime.UtcNow;
        var endedContests = await dbContext.Contests
            .Where(c => c.EndTime != null && c.EndTime <= now && c.CleanupTriggeredAt == null)
            .Select(c => new { c.Id, c.Name })
            .ToListAsync(ct);

        foreach (var contest in endedContests)
        {
            _logger.LogDebug($"Contest '{contest.Name}' (id={contest.Id}) ended — triggering cleanup");

            var challengeIds = await dbContext.Challenges
                .Where(c => c.ContestId == contest.Id && c.RequireDeploy)
                .Select(c => c.Id)
                .ToListAsync(ct);

            if (challengeIds.Count == 0)
            {
                await MarkCleanupDoneAsync(dbContext, contest.Id, now, ct);
                continue;
            }

            var challengeIdFilter = new HashSet<int>(challengeIds);
            var (successCount, failCount, errors) = await _k8sService.DeleteAllChallengeNamespaces(
                "ctf/kind=challenge", challengeIdFilter);

            foreach (var cid in challengeIdFilter)
                await _redisHelper.RemoveCacheByPattern($"deploy_challenge_{cid}_*");

            if (failCount > 0)
            {
                await Console.Error.WriteLineAsync(
                    $"[WARNING] ContestEndCleanupService: contest {contest.Id} partial failure — " +
                    $"stopped={successCount} failed={failCount}. " +
                    $"cleanup_triggered_at NOT set; next cycle will retry. " +
                    $"Errors: {string.Join("; ", errors)}");
            }
            else
            {
                await MarkCleanupDoneAsync(dbContext, contest.Id, now, ct);
                _logger.LogDebug($"Contest {contest.Id} cleanup complete", new { successCount });
            }
        }
    }

    private static async Task MarkCleanupDoneAsync(AppDbContext dbContext, int contestId, DateTime now, CancellationToken ct)
    {
        var contest = await dbContext.Contests.FindAsync(new object[] { contestId }, ct);
        if (contest == null) return;
        contest.CleanupTriggeredAt = now;
        await dbContext.SaveChangesAsync(ct);
    }
}

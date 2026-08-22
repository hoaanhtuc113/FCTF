using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
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
    private readonly WorkerHeartbeat _heartbeat;
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    public ContestEndCleanupService(
        IServiceScopeFactory scopeFactory,
        IK8sService k8sService,
        RedisHelper redisHelper,
        AppLogger logger,
        WorkerHeartbeat heartbeat)
    {
        _scopeFactory = scopeFactory;
        _k8sService = k8sService;
        _redisHelper = redisHelper;
        _logger = logger;
        _heartbeat = heartbeat;
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

            _heartbeat.PingCleanupTick();
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

        _logger.LogDebug("ContestEndCleanupService tick", new { now, endedContestCount = endedContests.Count });

        foreach (var contest in endedContests)
        {
            _logger.Log("contest_cleanup_started", null, null,
                new { contest.Name }, level: LogLevel.Information, contestId: contest.Id);

            var challengeIds = await dbContext.Challenges
                .Where(c => c.ContestId == contest.Id && c.RequireDeploy)
                .Select(c => c.Id)
                .ToListAsync(ct);

            if (challengeIds.Count == 0)
            {
                _logger.Log("contest_cleanup_skipped_no_challenges", null, null,
                    level: LogLevel.Information, contestId: contest.Id);
                await MarkCleanupDoneAsync(dbContext, contest.Id, now, ct);
                continue;
            }

            var challengeIdFilter = new HashSet<int>(challengeIds);
            var (successCount, failCount, errors) = await _k8sService.DeleteAllChallengeNamespaces(
                "ctf/kind=challenge", challengeIdFilter);

            _logger.Log("contest_cleanup_namespace_delete_result", null, null,
                new { challengeCount = challengeIdFilter.Count, successCount, failCount, errors },
                level: failCount > 0 ? LogLevel.Warning : LogLevel.Information,
                contestId: contest.Id);

            if (failCount > 0)
            {
                // Do NOT touch Redis for this contest: the deployments that failed to
                // delete from K8s must stay visible in the deployment cache, otherwise
                // the admin UI reports "clean" while the pod is still live in the
                // cluster. cleanup_triggered_at stays null so the next tick retries
                // the whole contest, including the namespaces that already succeeded
                // (DeleteAllChallengeNamespaces treats an already-gone namespace as a
                // no-op success, so re-running it is safe).
                _logger.Log("contest_cleanup_partial_failure", null, null,
                    new
                    {
                        stopped = successCount,
                        failed = failCount,
                        errors,
                        note = "cleanup_triggered_at NOT set; redis NOT cleared; next tick will retry"
                    },
                    level: LogLevel.Warning, contestId: contest.Id);
                continue;
            }

            // A namespace delete call returning without error only means the K8s API
            // accepted the delete request (or the namespace was already gone) - it does
            // NOT mean the pods inside are actually gone yet, since namespace teardown
            // can stall behind a finalizer or simply take longer than this tick. Re-list
            // the live pods for these challenge ids before trusting the delete and before
            // clearing Redis, otherwise the deployment cache/admin UI can go "clean" one
            // tick before the cluster actually catches up (or never, if teardown is stuck).
            var stillRunning = await _k8sService.GetPodsByLabel(
                $"ctf/kind=challenge,ctf/challenge-id in ({string.Join(",", challengeIdFilter)})");

            if (stillRunning.Count > 0)
            {
                _logger.Log("contest_cleanup_pods_still_present_after_delete", null, null,
                    new
                    {
                        podCount = stillRunning.Count,
                        pods = stillRunning.Select(p => new { p.Name, p.Namespace, p.ChallengeId, p.TeamId, p.Status, p.Age }),
                        note = "namespace delete reported success but pods are still visible in the cluster " +
                               "(likely still terminating, or stuck on a finalizer); " +
                               "cleanup_triggered_at NOT set; redis NOT cleared; next tick will re-verify"
                    },
                    level: LogLevel.Warning, contestId: contest.Id);
                continue;
            }

            // Same helper the manual stop-all uses, so both paths also clear the
            // active-deployment ZSET entries rather than only the JSON keys. Only
            // reached once the cluster has confirmed zero pods remain, so this can't
            // mark the deployment cache clean ahead of the actual infrastructure.
            foreach (var cid in challengeIdFilter)
                await _redisHelper.RemoveDeploymentsForChallenge(cid);

            await MarkCleanupDoneAsync(dbContext, contest.Id, now, ct);
            _logger.Log("contest_cleanup_completed", null, null,
                new { successCount }, level: LogLevel.Information, contestId: contest.Id);
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

using ContestantBE.Utils;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ContestantBE.Services;

/// <summary>
/// Background service quét các phiên KYPO đang mở để phát hiện "hết giờ".
///
/// Cơ chế: KHÔNG poll liên tục chờ hoàn thành. Watcher này chỉ:
///   - Tìm phiên KYPO (challenge_start_tracking, label="kypo", chưa stopped)
///   - Nếu started_at + time_limit (phút) &lt;= now → HẾT GIỜ
///   - Đánh dấu stopped_at + gọi chốt điểm (all-or-nothing)
///
/// Trigger "Stop" do ChallengeController xử lý trực tiếp; watcher lo "hết giờ".
/// </summary>
public class KypoTimeoutWatcher : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<KypoTimeoutWatcher> _logger;

    public KypoTimeoutWatcher(IServiceScopeFactory scopeFactory, ILogger<KypoTimeoutWatcher> logger)
    {
        _scopeFactory = scopeFactory;
        _logger       = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "[KYPO TIMEOUT] ✅ Watcher started (interval={Interval}s)",
            ContestantBEConfigHelper.KypoPollIntervalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(
                TimeSpan.FromSeconds(ContestantBEConfigHelper.KypoPollIntervalSeconds),
                stoppingToken);

            try
            {
                await ScanExpiredSessionsAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[KYPO TIMEOUT] Lỗi quét phiên hết giờ");
            }
        }

        _logger.LogInformation("[KYPO TIMEOUT] Watcher stopped");
    }

    private async Task ScanExpiredSessionsAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var db          = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var lockService = scope.ServiceProvider.GetRequiredService<KypoScoreLockService>();

        var now = DateTime.UtcNow;

        // Phiên KYPO đang mở + challenge có time_limit
        var openSessions = await (
            from t in db.ChallengeStartTrackings
            join c in db.Challenges on t.ChallengeId equals c.Id
            where t.StoppedAt == null
               && t.Label == "kypo"
               && t.TeamId != null
               && c.TimeLimit != null
               && c.TimeLimit > 0
            select new
            {
                t.Id,
                t.ChallengeId,
                TeamId    = t.TeamId!.Value,
                t.StartedAt,
                TimeLimit = c.TimeLimit!.Value   // đơn vị: PHÚT
            }
        ).ToListAsync();

        foreach (var s in openSessions)
        {
            var deadline = s.StartedAt.AddMinutes(s.TimeLimit);
            if (deadline > now) continue; // chưa hết giờ

            // Chốt điểm TRƯỚC khi đánh dấu stopped_at.
            // Nếu KYPO API không phản hồi (ApiError), giữ nguyên session để cycle sau retry.
            KypoLockResult lockResult;
            try
            {
                lockResult = await lockService.LockScoreAsync(s.ChallengeId, s.TeamId);
                _logger.LogInformation(
                    "[KYPO TIMEOUT] Hết giờ challenge={ChallengeId} team={TeamId} → {Result}",
                    s.ChallengeId, s.TeamId, lockResult);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "[KYPO TIMEOUT] Chốt điểm hết giờ lỗi challenge={ChallengeId} team={TeamId} — sẽ retry cycle sau",
                    s.ChallengeId, s.TeamId);
                continue; // Không đánh dấu stopped — retry lần sau
            }

            if (lockResult == KypoLockResult.ApiError)
            {
                _logger.LogWarning(
                    "[KYPO TIMEOUT] ApiError challenge={ChallengeId} team={TeamId} — sẽ retry cycle sau",
                    s.ChallengeId, s.TeamId);
                continue; // Không đánh dấu stopped — retry lần sau
            }

            // Đánh dấu stopped_at sau khi chốt điểm thành công (hoặc NotDone/AlreadySolved)
            var tracking = await db.ChallengeStartTrackings
                .FirstOrDefaultAsync(x => x.Id == s.Id);
            if (tracking != null && tracking.StoppedAt == null)
            {
                tracking.StoppedAt = now;
                await db.SaveChangesAsync();
            }
        }
    }
}

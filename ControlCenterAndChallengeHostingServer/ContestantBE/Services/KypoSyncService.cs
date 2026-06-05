using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ContestantBE.Services;

/// <summary>
/// Sync 1 KYPO instance: gọi Progress API → map team → ghi submissions + solves.
/// </summary>
public class KypoSyncService
{
    private readonly AppDbContext _db;
    private readonly KypoApiClient _kypoClient;
    private readonly ILogger<KypoSyncService> _logger;

    // Cache: training_run_id → team_id (tránh gọi API lặp lại)
    private readonly Dictionary<int, int> _runTeamCache = new();

    public KypoSyncService(AppDbContext db, KypoApiClient kypoClient, ILogger<KypoSyncService> logger)
    {
        _db         = db;
        _kypoClient = kypoClient;
        _logger     = logger;
    }

    /// <summary>
    /// Sync toàn bộ KYPO instance còn team chưa solve.
    /// Trả về tổng số solve mới được ghi.
    /// </summary>
    public async Task<int> SyncAllAsync()
    {
        var configs = await _db.KypoChallengeConfigs
            .Include(c => c.Challenge)
            .ToListAsync();
        if (configs.Count == 0) return 0;

        var now       = DateTime.UtcNow;
        var total     = 0;
        var syncTasks = new List<(KypoChallengeConfig Config, Task<int> Task)>();

        foreach (var config in configs)
        {
            // ── Kiểm tra time limit của challenge ────────────────
            var challenge = config.Challenge;
            var timeLimit = challenge?.TimeLimit; // giây

            // Bước 1: Lấy các team chưa solve challenge này
            var unsolvedTeamIds = await (
                from kta in _db.KypoTeamAccounts
                join s in _db.Solves
                    on new { kta.TeamId, ChallengeId = config.ChallengeId }
                    equals new { TeamId = s.TeamId!.Value, ChallengeId = s.ChallengeId!.Value }
                    into solved
                from s in solved.DefaultIfEmpty()
                where s == null
                select kta.TeamId
            ).ToListAsync();

            if (unsolvedTeamIds.Count == 0)
            {
                _logger.LogDebug("[KYPO POLL] Challenge {ChallengeId}: tất cả team đã solve, skip", config.ChallengeId);
                continue;
            }

            // Bước 2: Nếu có time limit → lọc bỏ team đã hết giờ
            int pendingCount = unsolvedTeamIds.Count;
            if (timeLimit.HasValue)
            {
                var expiredTeamIds = await _db.ChallengeStartTrackings
                    .Where(t => t.ChallengeId == config.ChallengeId
                             && t.TeamId.HasValue
                             && unsolvedTeamIds.Contains(t.TeamId!.Value)
                             && t.StartedAt.AddSeconds(timeLimit.Value) <= now)
                    .Select(t => t.TeamId!.Value)
                    .Distinct()
                    .ToListAsync();

                pendingCount = unsolvedTeamIds.Count - expiredTeamIds.Count;

                if (expiredTeamIds.Count > 0)
                    _logger.LogInformation(
                        "[KYPO POLL] Challenge {ChallengeId}: {Count} team hết giờ, không poll",
                        config.ChallengeId, expiredTeamIds.Count);
            }

            if (pendingCount <= 0)
            {
                _logger.LogDebug(
                    "[KYPO POLL] Challenge {ChallengeId}: không còn team cần poll (hết giờ hết), skip",
                    config.ChallengeId);
                continue;
            }

            syncTasks.Add((config, SyncInstanceAsync(config)));
        }

        // Chạy tất cả instance song song
        foreach (var (config, task) in syncTasks)
        {
            try
            {
                var n = await task;
                if (n > 0)
                    _logger.LogInformation("[KYPO POLL] Instance {InstanceId}: +{Count} solve(s)", config.KypoInstanceId, n);
                total += n;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[KYPO POLL] Instance {InstanceId} lỗi", config.KypoInstanceId);
            }
        }

        return total;
    }

    /// <summary>
    /// Sync 1 instance. Trả về số team vừa được ghi solve.
    /// </summary>
    public async Task<int> SyncInstanceAsync(KypoChallengeConfig config)
    {
        var baseUrl = config.KypoBaseUrl ?? "";
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            _logger.LogWarning("[KYPO SYNC] Challenge {ChallengeId}: KypoBaseUrl trống", config.ChallengeId);
            return 0;
        }

        // [0] Kiểm tra instance còn hạn không
        var endTime = await _kypoClient.GetInstanceEndTimeAsync(
            baseUrl, config.KypoInstanceType, config.KypoInstanceId);

        if (endTime.HasValue && endTime.Value < DateTime.UtcNow)
        {
            _logger.LogInformation(
                "[KYPO SYNC] Instance {Id} đã hết hạn lúc {EndTime} (UTC), dừng poll",
                config.KypoInstanceId, endTime.Value);
            return 0;
        }

        var progressList = await _kypoClient.GetInstanceProgressAsync(
            baseUrl, config.KypoInstanceType, config.KypoInstanceId);

        var finished = 0;

        foreach (var entry in progressList)
        {
            if (!entry.IsFinished) continue;

            // Map training_run_id → team_id qua Participant API + Keycloak
            var teamId = await GetTeamIdByTrainingRunAsync(
                baseUrl, config.KypoInstanceType, entry.RunId);

            if (teamId == null)
            {
                _logger.LogDebug("[KYPO SYNC] Không tìm thấy team cho training_run_id={RunId}", entry.RunId);
                continue;
            }

            // Lấy captain của team làm user_id cho solve
            var userId = await GetTeamCaptainAsync(teamId.Value);
            if (userId == null)
            {
                _logger.LogWarning("[KYPO SYNC] Team {TeamId} không có captain, bỏ qua", teamId);
                continue;
            }

            // Kiểm tra đã solve chưa
            var alreadySolved = await _db.Solves
                .AnyAsync(s => s.ChallengeId == config.ChallengeId && s.TeamId == teamId.Value);

            if (alreadySolved) continue;

            // Tính điểm
            var score = entry.TotalScore > 0
                ? entry.TotalScore
                : await GetChallengeFallbackScore(config.ChallengeId);

            // Ghi vào DB
            await InsertSolveAsync(config.ChallengeId, userId.Value, teamId.Value, score);

            _logger.LogInformation(
                "[KYPO SYNC] ✅ SOLVED challenge={ChallengeId} team={TeamId} user={UserId} score={Score}",
                config.ChallengeId, teamId, userId, score);

            finished++;
        }

        return finished;
    }

    // ─────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────

    /// <summary>
    /// Map training_run_id → team_id qua:
    /// 1. Cache (nếu đã biết)
    /// 2. Participant API → sub (email)
    /// 3. Keycloak Users API → kypo_user_id (UUID)
    /// 4. kypo_team_accounts → team_id (match bằng UUID, bất biến)
    /// </summary>
    private async Task<int?> GetTeamIdByTrainingRunAsync(
        string baseUrl, string instanceType, int trainingRunId)
    {
        // Kiểm tra cache trước
        if (_runTeamCache.TryGetValue(trainingRunId, out var cachedTeamId))
            return cachedTeamId;

        // Bước 1: training_run_id → sub (email)
        var sub = await _kypoClient.GetParticipantSubAsync(baseUrl, instanceType, trainingRunId);
        if (string.IsNullOrEmpty(sub))
        {
            _logger.LogDebug("[KYPO SYNC] Không lấy được sub từ training_run_id={RunId}", trainingRunId);
            return null;
        }

        // Bước 2: sub → Keycloak UUID (kypo_user_id)
        var keycloakUserId = await _kypoClient.GetKeycloakUserIdBySubAsync(baseUrl, sub);
        if (string.IsNullOrEmpty(keycloakUserId))
        {
            _logger.LogDebug("[KYPO SYNC] Không lấy được Keycloak UUID từ sub={Sub}", sub);
            return null;
        }

        // Bước 3: kypo_user_id (UUID) → team_id — UUID bất biến, chính xác 100%
        var account = await _db.KypoTeamAccounts
            .FirstOrDefaultAsync(a => a.KypoUserId == keycloakUserId);

        if (account == null)
        {
            _logger.LogDebug("[KYPO SYNC] Không tìm thấy team cho kypo_user_id='{UserId}'", keycloakUserId);
            return null;
        }

        // Lưu cache
        _runTeamCache[trainingRunId] = account.TeamId;
        _logger.LogDebug("[KYPO SYNC] Cache: training_run_id={RunId} → team_id={TeamId}", trainingRunId, account.TeamId);
        return account.TeamId;
    }

    private async Task<int?> GetTeamCaptainAsync(int teamId)
    {
        var team = await _db.Teams.AsNoTracking().FirstOrDefaultAsync(t => t.Id == teamId);
        if (team?.CaptainId != null) return team.CaptainId;

        // Fallback: user đầu tiên trong team
        var user = await _db.Users.AsNoTracking()
            .Where(u => u.TeamId == teamId)
            .OrderBy(u => u.Id)
            .FirstOrDefaultAsync();
        return user?.Id;
    }

    private async Task<int> GetChallengeFallbackScore(int? challengeId)
    {
        if (challengeId == null) return 0;
        var challenge = await _db.Challenges.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == challengeId);
        return challenge?.Value ?? 0;
    }

    private async Task InsertSolveAsync(int? challengeId, int userId, int teamId, int score)
    {
        var now = DateTime.UtcNow;

        // 1. INSERT submissions
        var submission = new Submission
        {
            ChallengeId = challengeId,
            UserId      = userId,
            TeamId      = teamId,
            Ip          = "",
            Provided    = "KYPO_AUTO_SOLVE",
            Type        = "correct",
            Date        = now,
        };
        _db.Submissions.Add(submission);
        await _db.SaveChangesAsync(); // để lấy submission.Id

        // 2. INSERT solves (dùng chung Id với submission)
        var solve = new Solf
        {
            Id          = submission.Id,
            ChallengeId = challengeId,
            UserId      = userId,
            TeamId      = teamId,
            Value       = score,
        };
        _db.Solves.Add(solve);
        await _db.SaveChangesAsync();
    }
}

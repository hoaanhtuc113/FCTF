using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ContestantBE.Services;

/// <summary>
/// Chốt điểm KYPO cho 1 team theo cơ chế ALL-OR-NOTHING.
///
/// Trigger: Stop hoặc hết giờ → gọi LockScoreAsync(challengeId, teamId).
///
/// Quy tắc:
///   - KYPO chỉ dùng để xác định TRẠNG THÁI hoàn thành (tất cả phase FINISHED và score > 0).
///   - Điểm LẤY TỪ FCTF (challenges.value), KHÔNG dùng score của KYPO.
///   - Hoàn thành tất cả phase → ghi solve với value = challenges.value.
///   - Còn phase chưa xong → 0 điểm, không ghi solve.
/// </summary>
public class KypoScoreLockService
{
    private readonly AppDbContext _db;
    private readonly KypoApiClient _kypoClient;
    private readonly ILogger<KypoScoreLockService> _logger;

    // Cache: training_run_id → team_id
    private readonly Dictionary<int, int> _runTeamCache = new();

    public KypoScoreLockService(AppDbContext db, KypoApiClient kypoClient, ILogger<KypoScoreLockService> logger)
    {
        _db         = db;
        _kypoClient = kypoClient;
        _logger     = logger;
    }

    /// <summary>
    /// Chốt điểm cho 1 team trên 1 challenge KYPO.
    /// Trả về true nếu vừa ghi solve (hoàn thành tất cả phase).
    /// </summary>
    public async Task<bool> LockScoreAsync(int challengeId, int teamId)
    {
        // [1] Lấy KypoChallengeConfig qua raw SQL (bảng không có trong AppDbContext)
        var config = await GetKypoChallengeConfigAsync(challengeId);
        if (config == null)
        {
            _logger.LogDebug("[KYPO LOCK] Challenge {ChallengeId} không phải KYPO challenge", challengeId);
            return false;
        }

        // [2] Đã chốt điểm chưa?
        var alreadySolved = await _db.Solves
            .AnyAsync(s => s.ChallengeId == challengeId && s.TeamId == teamId);
        if (alreadySolved)
        {
            _logger.LogDebug("[KYPO LOCK] Team {TeamId} đã có solve cho challenge {ChallengeId}", teamId, challengeId);
            return false;
        }

        var baseUrl = config.KypoBaseUrl ?? ContestantBEConfigHelper.KypoBaseUrl;
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            _logger.LogWarning("[KYPO LOCK] Challenge {ChallengeId}: KypoBaseUrl trống", challengeId);
            return false;
        }

        // [3] Poll KYPO 1 lần
        List<KypoProgressEntry> progressList;
        try
        {
            progressList = await _kypoClient.GetInstanceProgressAsync(
                baseUrl, config.KypoInstanceType, config.KypoInstanceId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[KYPO LOCK] Lỗi gọi Progress API instance {InstanceId}", config.KypoInstanceId);
            return false;
        }

        // [4] Map ngược tìm entry của team đang chốt
        KypoProgressEntry? teamEntry = null;
        foreach (var entry in progressList)
        {
            var mappedTeamId = await GetTeamIdByTrainingRunAsync(
                baseUrl, config.KypoInstanceType, entry.RunId);

            if (mappedTeamId == teamId)
            {
                teamEntry = entry;
                break;
            }
        }

        if (teamEntry == null)
        {
            _logger.LogDebug("[KYPO LOCK] Không tìm thấy progress của team {TeamId} trong instance {InstanceId}",
                teamId, config.KypoInstanceId);
            return false;
        }

        // [5] ALL-OR-NOTHING: tất cả phase FINISHED và score > 0
        var allDone = teamEntry.Levels.Count > 0
            && teamEntry.Levels.All(l => l.State == "FINISHED" && l.Score > 0);

        if (!allDone)
        {
            _logger.LogInformation(
                "[KYPO LOCK] Team {TeamId} challenge {ChallengeId}: CHƯA hoàn thành hết phase → 0 điểm",
                teamId, challengeId);
            return false;
        }

        // [6] user_id = captain của team
        var userId = await GetTeamCaptainAsync(teamId);
        if (userId == null)
        {
            _logger.LogWarning("[KYPO LOCK] Team {TeamId} không có user, bỏ qua", teamId);
            return false;
        }

        // [7] Ghi solve
        await InsertSolveAsync(challengeId, userId.Value, teamId);

        _logger.LogInformation(
            "[KYPO LOCK] ✅ SOLVED challenge={ChallengeId} team={TeamId} user={UserId}",
            challengeId, teamId, userId);

        return true;
    }

    // ──────────────────────────────────────────────────────────
    // Raw SQL helpers cho bảng KYPO (không trong AppDbContext)
    // ──────────────────────────────────────────────────────────

    private async Task<KypoChallengeConfig?> GetKypoChallengeConfigAsync(int challengeId)
    {
        var rows = await _db.Database.SqlQueryRaw<KypoConfigRaw>(
            "SELECT id, challenge_id, kypo_instance_id, kypo_access_token, kypo_instance_type, kypo_base_url " +
            "FROM kypo_challenge_configs WHERE challenge_id = {0} LIMIT 1",
            challengeId
        ).ToListAsync();

        var row = rows.FirstOrDefault();
        if (row == null) return null;

        return new KypoChallengeConfig
        {
            Id              = row.id,
            ChallengeId     = row.challenge_id,
            KypoInstanceId  = row.kypo_instance_id,
            KypoAccessToken = row.kypo_access_token ?? "",
            KypoInstanceType = row.kypo_instance_type ?? "linear",
            KypoBaseUrl     = row.kypo_base_url,
        };
    }

    private async Task<KypoTeamAccount?> GetKypoTeamAccountByUserIdAsync(string kypoUserId)
    {
        var rows = await _db.Database.SqlQueryRaw<KypoAccountRaw>(
            "SELECT id, team_id, kypo_user_id, kypo_username, kypo_password " +
            "FROM kypo_team_accounts WHERE kypo_user_id = {0} LIMIT 1",
            kypoUserId
        ).ToListAsync();

        var row = rows.FirstOrDefault();
        if (row == null) return null;

        return new KypoTeamAccount
        {
            Id           = row.id,
            TeamId       = row.team_id,
            KypoUserId   = row.kypo_user_id ?? "",
            KypoUsername = row.kypo_username ?? "",
            KypoPassword = row.kypo_password ?? "",
        };
    }

    // ──────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────

    private async Task<int?> GetTeamIdByTrainingRunAsync(
        string baseUrl, string instanceType, int trainingRunId)
    {
        if (_runTeamCache.TryGetValue(trainingRunId, out var cached))
            return cached;

        var sub = await _kypoClient.GetParticipantSubAsync(baseUrl, instanceType, trainingRunId);
        if (string.IsNullOrEmpty(sub)) return null;

        var keycloakUserId = await _kypoClient.GetKeycloakUserIdBySubAsync(baseUrl, sub);
        if (string.IsNullOrEmpty(keycloakUserId)) return null;

        var account = await GetKypoTeamAccountByUserIdAsync(keycloakUserId);
        if (account == null) return null;

        _runTeamCache[trainingRunId] = account.TeamId;
        return account.TeamId;
    }

    private async Task<int?> GetTeamCaptainAsync(int teamId)
    {
        var team = await _db.Teams.AsNoTracking().FirstOrDefaultAsync(t => t.Id == teamId);
        if (team?.CaptainUserId != null) return team.CaptainUserId;

        // Fallback: lấy member đầu tiên qua UserTeamMembers
        var member = await _db.UserTeamMembers
            .AsNoTracking()
            .Where(m => m.TeamId == teamId)
            .OrderBy(m => m.UserId)
            .FirstOrDefaultAsync();
        return member?.UserId;
    }

    private async Task InsertSolveAsync(int challengeId, int userId, int teamId)
    {
        var now = DateTime.UtcNow;

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
        await _db.SaveChangesAsync();

        var solve = new Solf
        {
            Id          = submission.Id,
            ChallengeId = challengeId,
            UserId      = userId,
            TeamId      = teamId,
        };
        _db.Solves.Add(solve);
        await _db.SaveChangesAsync();
    }

    // ──────────────────────────────────────────────────────────
    // Raw SQL result types
    // ──────────────────────────────────────────────────────────

    private class KypoConfigRaw
    {
        public int    id               { get; set; }
        public int    challenge_id     { get; set; }
        public int    kypo_instance_id { get; set; }
        public string? kypo_access_token { get; set; }
        public string? kypo_instance_type { get; set; }
        public string? kypo_base_url   { get; set; }
    }

    private class KypoAccountRaw
    {
        public int    id            { get; set; }
        public int    team_id       { get; set; }
        public string? kypo_user_id  { get; set; }
        public string? kypo_username { get; set; }
        public string? kypo_password { get; set; }
    }
}

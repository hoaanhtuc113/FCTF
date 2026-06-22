using ContestantBE.Utils;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ContestantBE.Services;

/// <summary>
/// Locks KYPO score for one team using ALL-OR-NOTHING logic.
///
/// Trigger: user clicks Stop/Submit → LockScoreAsync(challengeId, teamId).
///
/// Rules:
///   - KYPO is used only to determine completion state (all phases done).
///   - Points come from FCTF (challenges.value), NOT from KYPO score.
///   - All phases completed → insert solve; score = challenges.value.
///   - Any phase incomplete → no solve, 0 points.
///   - KYPO API unreachable → ApiError (caller should allow team to retry).
/// </summary>
public class KypoScoreLockService
{
    private readonly AppDbContext _db;
    private readonly KypoApiClient _kypoClient;
    private readonly ILogger<KypoScoreLockService> _logger;

    public KypoScoreLockService(AppDbContext db, KypoApiClient kypoClient, ILogger<KypoScoreLockService> logger)
    {
        _db         = db;
        _kypoClient = kypoClient;
        _logger     = logger;
    }

    /// <summary>
    /// Locks score for one team on one KYPO challenge.
    /// Returns KypoLockResult — caller must treat ApiError as retryable (do NOT close session).
    /// </summary>
    public async Task<KypoLockResult> LockScoreAsync(int challengeId, int teamId)
    {
        // [1] Lấy KypoChallengeConfig
        var config = await GetKypoChallengeConfigAsync(challengeId);
        if (config == null)
        {
            _logger.LogDebug("[KYPO LOCK] Challenge {ChallengeId} không phải KYPO challenge", challengeId);
            return KypoLockResult.NotDone;
        }

        // [2] Đã chốt điểm chưa?
        var alreadySolved = await _db.Solves
            .AnyAsync(s => s.ChallengeId == challengeId && s.TeamId == teamId);
        if (alreadySolved)
        {
            _logger.LogDebug("[KYPO LOCK] Team {TeamId} đã có solve cho challenge {ChallengeId}", teamId, challengeId);
            return KypoLockResult.AlreadySolved;
        }

        var baseUrl = config.kypo_base_url ?? ContestantBEConfigHelper.KypoBaseUrl;
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            _logger.LogWarning("[KYPO LOCK] Challenge {ChallengeId}: KypoBaseUrl trống", challengeId);
            return KypoLockResult.NotDone;
        }

        var instanceType = config.kypo_instance_type ?? "linear";

        // [3] Lấy progress (từ cache hoặc API)
        List<KypoProgressEntry> progressList;
        try
        {
            progressList = await _kypoClient.GetInstanceProgressAsync(
                baseUrl, instanceType, config.kypo_instance_id);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[KYPO LOCK] Lỗi gọi Progress API instance {InstanceId}", config.kypo_instance_id);
            return KypoLockResult.ApiError;
        }

        // [4] Map participant → team song song
        var allAccounts = await _db.Database.SqlQueryRaw<KypoTeamAccount>(
            "SELECT id, team_id, kypo_user_id, kypo_username, kypo_password FROM kypo_team_accounts"
        ).ToListAsync();

        var keycloakIdToTeam = allAccounts
            .Where(a => !string.IsNullOrEmpty(a.kypo_user_id))
            .ToDictionary(a => a.kypo_user_id!, a => a.team_id);

        var mappingTasks = progressList.Select(async entry =>
        {
            if (_kypoClient.RunTeamCache.TryGetValue(entry.RunId, out var cachedId))
                return (Entry: entry, TeamId: (int?)cachedId);

            try
            {
                var sub = await _kypoClient.GetParticipantSubAsync(baseUrl, instanceType, entry.RunId);
                if (string.IsNullOrEmpty(sub)) return (Entry: entry, TeamId: (int?)null);

                var kcId = await _kypoClient.GetKeycloakUserIdBySubAsync(baseUrl, sub);
                if (string.IsNullOrEmpty(kcId)) return (Entry: entry, TeamId: (int?)null);

                keycloakIdToTeam.TryGetValue(kcId, out var tid);
                if (tid != 0) _kypoClient.RunTeamCache.TryAdd(entry.RunId, tid);
                return (Entry: entry, TeamId: tid == 0 ? (int?)null : tid);
            }
            catch
            {
                return (Entry: entry, TeamId: (int?)null);
            }
        }).ToList();

        var mappings  = await Task.WhenAll(mappingTasks);
        // Pick the run with the highest RunId (newest) — a team may have multiple runs
        // if two members entered the same challenge simultaneously
        var teamEntry = mappings
            .Where(m => m.TeamId == teamId && m.Entry != null)
            .OrderByDescending(m => m.Entry!.RunId)
            .Select(m => m.Entry)
            .FirstOrDefault();

        if (teamEntry == null)
        {
            _logger.LogDebug("[KYPO LOCK] Không tìm thấy progress của team {TeamId} trong instance {InstanceId}",
                teamId, config.kypo_instance_id);
            return KypoLockResult.NotDone;
        }

        // [5] ALL-OR-NOTHING: every phase must be IsCompleted.
        // Do NOT check Score > 0 — access/info levels have max_score=0 and will always be Score=0.
        // IsCompleted handles TrainingRunResumed (state=RUNNING but LevelCompleted event exists).
        //
        // IMPORTANT: KYPO only returns levels that have been STARTED — not all levels.
        // A team that completed phase 1 of 3 would show Levels=[phase1:done] → All()=true incorrectly.
        // Guard: compare returned level count against expected count from training definition.
        int expectedLevelCount = 0;
        try
        {
            expectedLevelCount = await _kypoClient.GetTrainingDefinitionLevelCountAsync(
                baseUrl, instanceType, config.kypo_instance_id);
            _logger.LogInformation(
                "[KYPO LOCK] Team {TeamId} challenge {ChallengeId}: returned={Returned}, expected={Expected}",
                teamId, challengeId, teamEntry.Levels.Count, expectedLevelCount);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[KYPO LOCK] Không lấy được level count instance {InstanceId}", config.kypo_instance_id);
        }

        var levelCountOk = expectedLevelCount <= 0 || teamEntry.Levels.Count >= expectedLevelCount;
        var allDone = teamEntry.Levels.Count > 0
            && teamEntry.Levels.All(l => l.IsCompleted)
            && levelCountOk;

        if (!allDone)
        {
            _logger.LogInformation(
                "[KYPO LOCK] Team {TeamId} challenge {ChallengeId}: CHƯA hoàn thành " +
                "(returned={Returned}, expected={Expected}, allCompleted={AllCompleted}, countOk={CountOk}) → 0 điểm",
                teamId, challengeId, teamEntry.Levels.Count, expectedLevelCount,
                teamEntry.Levels.Count > 0 && teamEntry.Levels.All(l => l.IsCompleted), levelCountOk);
            return KypoLockResult.NotDone;
        }

        // [6] user_id = captain của team
        var userId = await GetTeamCaptainAsync(teamId);
        if (userId == null)
        {
            _logger.LogWarning("[KYPO LOCK] Team {TeamId} không có user, bỏ qua", teamId);
            return KypoLockResult.NotDone;
        }

        // [7] Ghi solve
        try
        {
            await InsertSolveAsync(challengeId, userId.Value, teamId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[KYPO LOCK] Lỗi ghi solve challenge={ChallengeId} team={TeamId}", challengeId, teamId);
            return KypoLockResult.ApiError;
        }

        _logger.LogInformation("[KYPO LOCK] SOLVED challenge={ChallengeId} team={TeamId} user={UserId}",
            challengeId, teamId, userId);
        return KypoLockResult.Solved;
    }

    // ─────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────

    private async Task<KypoChallengeConfig?> GetKypoChallengeConfigAsync(int challengeId)
    {
        var rows = await _db.Database.SqlQueryRaw<KypoChallengeConfig>(
            "SELECT id, challenge_id, kypo_instance_id, kypo_access_token, kypo_instance_type, kypo_base_url " +
            "FROM kypo_challenge_configs WHERE challenge_id = {0} LIMIT 1",
            challengeId
        ).ToListAsync();
        return rows.FirstOrDefault();
    }


    private async Task<int?> GetTeamCaptainAsync(int teamId)
    {
        var team = await _db.Teams.AsNoTracking().FirstOrDefaultAsync(t => t.Id == teamId);
        if (team?.CaptainUserId != null) return team.CaptainUserId;

        var member = await _db.UserTeamMembers
            .AsNoTracking()
            .Where(m => m.TeamId == teamId)
            .OrderBy(m => m.UserId)
            .FirstOrDefaultAsync();
        return member?.UserId;
    }

    /// <summary>
    /// Writes a solve: inserts into submissions first (to get the ID), then into solves.
    /// Score is not stored here — it is derived from challenges.value at display time.
    /// </summary>
    private async Task InsertSolveAsync(int challengeId, int userId, int teamId)
    {
        var now = DateTime.UtcNow;

        // Idempotent: kiểm tra submission trùng trước khi INSERT
        var existingSubmission = await _db.Submissions
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.ChallengeId == challengeId
                                   && s.TeamId == teamId
                                   && s.Type == "correct");

        int submissionId;
        if (existingSubmission != null)
        {
            submissionId = existingSubmission.Id;
            _logger.LogDebug("[KYPO LOCK] Submission đã tồn tại cho challenge={ChallengeId} team={TeamId}, dùng lại Id={Id}",
                challengeId, teamId, submissionId);
        }
        else
        {
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
            submissionId = submission.Id;
        }

        // Idempotent: kiểm tra solve trùng trước khi INSERT
        var existingSolve = await _db.Solves
            .AsNoTracking()
            .AnyAsync(s => s.ChallengeId == challengeId && s.TeamId == teamId);
        if (existingSolve)
        {
            _logger.LogDebug("[KYPO LOCK] Solve đã tồn tại cho challenge={ChallengeId} team={TeamId}, bỏ qua",
                challengeId, teamId);
            return;
        }

        var solve = new Solf
        {
            Id          = submissionId,
            ChallengeId = challengeId,
            UserId      = userId,
            TeamId      = teamId,
        };
        _db.Solves.Add(solve);
        await _db.SaveChangesAsync();
    }
}

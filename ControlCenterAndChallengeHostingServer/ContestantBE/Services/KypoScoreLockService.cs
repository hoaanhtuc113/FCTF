using System.Collections.Concurrent;
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

    // Thread-safe cache: training_run_id → team_id (avoids repeated Participant/Keycloak API calls)
    private readonly ConcurrentDictionary<int, int> _runTeamCache = new();

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
        // [1] Load KYPO config for this challenge
        var config = await _db.KypoChallengeConfigs
            .FirstOrDefaultAsync(c => c.ChallengeId == challengeId);

        if (config == null)
        {
            _logger.LogDebug("[KYPO LOCK] Challenge {ChallengeId} is not a KYPO challenge", challengeId);
            return KypoLockResult.NotDone;
        }

        // [2] Already solved? Skip to avoid duplicate entries
        var alreadySolved = await _db.Solves
            .AnyAsync(s => s.ChallengeId == challengeId && s.TeamId == teamId);
        if (alreadySolved)
        {
            _logger.LogDebug("[KYPO LOCK] Team {TeamId} already has a solve for challenge {ChallengeId}", teamId, challengeId);
            return KypoLockResult.AlreadySolved;
        }

        var baseUrl = config.KypoBaseUrl ?? "";
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            _logger.LogWarning("[KYPO LOCK] Challenge {ChallengeId}: KypoBaseUrl is empty", challengeId);
            return KypoLockResult.NotDone;
        }

        // [3] Fetch progress for all participants in this instance (single API call)
        List<KypoProgressEntry> progressList;
        try
        {
            progressList = await _kypoClient.GetInstanceProgressAsync(
                baseUrl, config.KypoInstanceType, config.KypoInstanceId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[KYPO LOCK] Progress API failed for instance {InstanceId}", config.KypoInstanceId);
            return KypoLockResult.ApiError;
        }

        // [4] Map participants to team IDs in parallel.
        // Pre-load all KypoTeamAccounts into memory first (single DB query) so that
        // parallel tasks only call external APIs — no concurrent DbContext access.
        var allAccounts = await _db.KypoTeamAccounts.AsNoTracking().ToListAsync();
        var keycloakIdToTeam = allAccounts
            .Where(a => !string.IsNullOrEmpty(a.KypoUserId))
            .ToDictionary(a => a.KypoUserId!, a => a.TeamId);

        var mappingTasks = progressList
            .Select(async entry =>
            {
                // Cache hit — only use cache when RunId > 0 to prevent collision across entries sharing RunId=0
                if (entry.RunId > 0 && _runTeamCache.TryGetValue(entry.RunId, out var cachedId))
                    return (Entry: entry, TeamId: (int?)cachedId);

                if (entry.RunId <= 0)
                {
                    _logger.LogWarning("[KYPO LOCK] Entry name={Name} has RunId=0 — training_run_id missing or field name mismatch in KYPO response",
                        entry.Name);
                    return (Entry: entry, TeamId: (int?)null);
                }

                string? sub;
                string? keycloakUserId;
                try
                {
                    sub = await _kypoClient.GetParticipantSubAsync(
                        baseUrl, config.KypoInstanceType, entry.RunId);
                    if (string.IsNullOrEmpty(sub))
                        return (Entry: entry, TeamId: (int?)null);

                    keycloakUserId = await _kypoClient.GetKeycloakUserIdBySubAsync(baseUrl, sub);
                    if (string.IsNullOrEmpty(keycloakUserId))
                        return (Entry: entry, TeamId: (int?)null);
                }
                catch
                {
                    return (Entry: entry, TeamId: (int?)null);
                }

                // In-memory lookup — no DB access in parallel task
                keycloakIdToTeam.TryGetValue(keycloakUserId, out var tid);
                if (tid != 0) _runTeamCache.TryAdd(entry.RunId, tid);
                return (Entry: entry, TeamId: tid == 0 ? (int?)null : tid);
            })
            .ToList();

        var mappings = await Task.WhenAll(mappingTasks);

        // A team may have MULTIPLE training runs on the same instance (e.g. from previous challenges
        // that reused the same KYPO instance). Pick the run with the highest RunId (newest session).
        // This avoids accidentally picking an old incomplete run from a previous challenge.
        var teamEntry = mappings
            .Where(m => m.TeamId == teamId && m.Entry != null)
            .OrderByDescending(m => m.Entry!.RunId)
            .Select(m => m.Entry)
            .FirstOrDefault();

        if (teamEntry == null)
        {
            _logger.LogDebug("[KYPO LOCK] No progress entry found for team {TeamId} in instance {InstanceId}",
                teamId, config.KypoInstanceId);
            return KypoLockResult.NotDone;
        }

        _logger.LogInformation("[KYPO LOCK] Team {TeamId}: selected runId={RunId} (newest among {Total} run(s) for this team)",
            teamId, teamEntry.RunId, mappings.Count(m => m.TeamId == teamId));

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
                baseUrl, config.KypoInstanceType, config.KypoInstanceId);
            _logger.LogInformation(
                "[KYPO LOCK] Team {TeamId} challenge {ChallengeId}: returned={Returned} level(s), expected={Expected}",
                teamId, challengeId, teamEntry.Levels.Count, expectedLevelCount);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "[KYPO LOCK] Could not fetch expected level count for instance {InstanceId} — skipping count guard",
                config.KypoInstanceId);
        }

        var levelCountOk = expectedLevelCount <= 0 || teamEntry.Levels.Count >= expectedLevelCount;
        var allDone = teamEntry.Levels.Count > 0
            && teamEntry.Levels.All(l => l.IsCompleted)
            && levelCountOk;

        if (!allDone)
        {
            _logger.LogInformation(
                "[KYPO LOCK] Team {TeamId} challenge {ChallengeId}: not all phases done " +
                "(returned={Returned}, expected={Expected}, allCompleted={AllCompleted}, countOk={CountOk}) → 0 points",
                teamId, challengeId, teamEntry.Levels.Count, expectedLevelCount,
                teamEntry.Levels.Count > 0 && teamEntry.Levels.All(l => l.IsCompleted), levelCountOk);
            return KypoLockResult.NotDone;
        }

        // [6] Resolve user_id = team captain (or first member)
        var userId = await GetTeamCaptainAsync(teamId);
        if (userId == null)
        {
            _logger.LogWarning("[KYPO LOCK] Team {TeamId} has no users, skipping", teamId);
            return KypoLockResult.NotDone;
        }

        // [7] Insert solve — points come from challenges.value at display time
        try
        {
            await InsertSolveAsync(challengeId, userId.Value, teamId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[KYPO LOCK] Failed to insert solve for challenge={ChallengeId} team={TeamId}", challengeId, teamId);
            return KypoLockResult.ApiError;
        }

        _logger.LogInformation(
            "[KYPO LOCK] SOLVED challenge={ChallengeId} team={TeamId} user={UserId}",
            challengeId, teamId, userId);

        return KypoLockResult.Solved;
    }

    // ─────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────

    private async Task<int?> GetTeamCaptainAsync(int teamId)
    {
        var team = await _db.Teams.AsNoTracking().FirstOrDefaultAsync(t => t.Id == teamId);
        if (team?.CaptainId != null) return team.CaptainId;

        var user = await _db.Users.AsNoTracking()
            .Where(u => u.TeamId == teamId)
            .OrderBy(u => u.Id)
            .FirstOrDefaultAsync();
        return user?.Id;
    }

    /// <summary>
    /// Writes a solve: inserts into submissions first (to get the ID), then into solves.
    /// Score is not stored here — it is derived from challenges.value at display time.
    /// </summary>
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
        await _db.SaveChangesAsync(); // flush to get submission.Id

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
}

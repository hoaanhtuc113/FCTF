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
    /// Returns true if a solve was just inserted (all phases completed).
    /// </summary>
    public async Task<bool> LockScoreAsync(int challengeId, int teamId)
    {
        // [1] Load KYPO config for this challenge
        var config = await _db.KypoChallengeConfigs
            .FirstOrDefaultAsync(c => c.ChallengeId == challengeId);

        if (config == null)
        {
            _logger.LogDebug("[KYPO LOCK] Challenge {ChallengeId} is not a KYPO challenge", challengeId);
            return false;
        }

        // [2] Already solved? Skip to avoid duplicate entries
        var alreadySolved = await _db.Solves
            .AnyAsync(s => s.ChallengeId == challengeId && s.TeamId == teamId);
        if (alreadySolved)
        {
            _logger.LogDebug("[KYPO LOCK] Team {TeamId} already has a solve for challenge {ChallengeId}", teamId, challengeId);
            return false;
        }

        var baseUrl = config.KypoBaseUrl ?? "";
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            _logger.LogWarning("[KYPO LOCK] Challenge {ChallengeId}: KypoBaseUrl is empty", challengeId);
            return false;
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
            return false;
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
                // Cache hit — skip API calls
                if (_runTeamCache.TryGetValue(entry.RunId, out var cachedId))
                    return (Entry: entry, TeamId: (int?)cachedId);

                var sub = await _kypoClient.GetParticipantSubAsync(
                    baseUrl, config.KypoInstanceType, entry.RunId);
                if (string.IsNullOrEmpty(sub))
                    return (Entry: entry, TeamId: (int?)null);

                var keycloakUserId = await _kypoClient.GetKeycloakUserIdBySubAsync(baseUrl, sub);
                if (string.IsNullOrEmpty(keycloakUserId))
                    return (Entry: entry, TeamId: (int?)null);

                // In-memory lookup — no DB access in parallel task
                keycloakIdToTeam.TryGetValue(keycloakUserId, out var tid);
                if (tid != 0) _runTeamCache.TryAdd(entry.RunId, tid);
                return (Entry: entry, TeamId: tid == 0 ? (int?)null : tid);
            })
            .ToList();

        var mappings  = await Task.WhenAll(mappingTasks);
        var teamEntry = mappings.FirstOrDefault(m => m.TeamId == teamId).Entry;

        if (teamEntry == null)
        {
            _logger.LogDebug("[KYPO LOCK] No progress entry found for team {TeamId} in instance {InstanceId}",
                teamId, config.KypoInstanceId);
            return false;
        }

        // [5] ALL-OR-NOTHING: every phase must be IsCompleted.
        // Do NOT check Score > 0 — access/info levels have max_score=0 and will always be Score=0.
        // IsCompleted handles TrainingRunResumed (state=RUNNING but LevelCompleted event exists).
        var allDone = teamEntry.Levels.Count > 0
            && teamEntry.Levels.All(l => l.IsCompleted);

        if (!allDone)
        {
            _logger.LogInformation(
                "[KYPO LOCK] Team {TeamId} challenge {ChallengeId}: not all phases done → 0 points",
                teamId, challengeId);
            return false;
        }

        // [6] Resolve user_id = team captain (or first member)
        var userId = await GetTeamCaptainAsync(teamId);
        if (userId == null)
        {
            _logger.LogWarning("[KYPO LOCK] Team {TeamId} has no users, skipping", teamId);
            return false;
        }

        // [7] Insert solve — points come from challenges.value at display time
        await InsertSolveAsync(challengeId, userId.Value, teamId);

        _logger.LogInformation(
            "[KYPO LOCK] SOLVED challenge={ChallengeId} team={TeamId} user={UserId}",
            challengeId, teamId, userId);

        return true;
    }

    // ─────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────

    // GetTeamIdByTrainingRunAsync removed — logic inlined into LockScoreAsync step [4]
    // to avoid concurrent DbContext access when tasks run in parallel via Task.WhenAll.

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

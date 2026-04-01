using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Hint;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace ContestantBE.Services;

public class HintService : IHintService
{
    private readonly AppDbContext _context;
    private readonly ScoreHelper _scoreHelper;
    private readonly ConfigHelper _configHelper;
    private readonly RedisLockHelper _redisLockHelper;
    private readonly AppLogger _logger;

    private const string HintUnlockType = "hints";

    public HintService(
        AppDbContext context,
        ScoreHelper scoreHelper,
        ConfigHelper configHelper,
        RedisLockHelper redisLockHelper,
        AppLogger logger)
    {
        _context = context;
        _scoreHelper = scoreHelper;
        _configHelper = configHelper;
        _redisLockHelper = redisLockHelper;
        _logger = logger;
    }

    private List<int> GetPrerequisites(string? requirementsJson)
    {
        var result = new List<int>();
        if (string.IsNullOrWhiteSpace(requirementsJson)) return result;

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(requirementsJson);
            if (doc.RootElement.TryGetProperty("prerequisites", out var prereqElement) &&
                prereqElement.ValueKind == System.Text.Json.JsonValueKind.Array)
            {
                foreach (var item in prereqElement.EnumerateArray())
                {
                    if (item.TryGetInt32(out int value))
                    {
                        result.Add(value);
                    }

                }
            }
        }
        catch { }
        return result;
    }

    private async Task EnsureChallengePrerequisitesUnlockedAsync(Challenge challenge, User user)
    {
        if (string.IsNullOrWhiteSpace(challenge.Requirements))
        {
            return;
        }

        try
        {
            var requirementsObj = System.Text.Json.JsonSerializer.Deserialize<ChallengeRequirementsDTO>(challenge.Requirements);
            var prerequisites = requirementsObj?.prerequisites;

            if (prerequisites == null || prerequisites.Count == 0)
            {
                return;
            }

            var allChallengeIds = (await _context.Challenges
                    .AsNoTracking()
                    .Select(c => c.Id)
                    .ToListAsync())
                .ToHashSet();

            var validPrerequisites = prerequisites
                .Where(allChallengeIds.Contains)
                .ToHashSet();

            if (validPrerequisites.Count == 0)
            {
                return;
            }

            IQueryable<Solf> solvesQuery = _context.Solves
                .AsNoTracking()
                .Where(s => s.ChallengeId.HasValue);

            if (_configHelper.IsTeamsMode())
            {
                if (user.TeamId == null)
                {
                    throw new InvalidOperationException("User team not found");
                }

                solvesQuery = solvesQuery.Where(s => s.TeamId == user.TeamId);
            }
            else
            {
                solvesQuery = solvesQuery.Where(s => s.UserId == user.Id);
            }

            var solvedChallengeIds = (await solvesQuery
                    .Select(s => s.ChallengeId!.Value)
                    .ToListAsync())
                .ToHashSet();

            if (!validPrerequisites.IsSubsetOf(solvedChallengeIds))
            {
                throw new InvalidOperationException("You don't have the permission to unlock hints for this challenge. Complete the required challenges first.");
            }
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, user.Id, user.TeamId, new { challengeId = challenge.Id, requirements = challenge.Requirements });
        }
    }

    public async Task<HintResponseDTO?> GetHintById(int id, int? userId, bool preview)
    {
        try
        {
            var hint = await _context.Hints
                .AsNoTracking()
                .Include(h => h.Challenge)
                .FirstOrDefaultAsync(h => h.Id == id);

            if (hint == null) return null;
            if (!hint.Challenge.State.Equals("visible"))
            {
                return null;
            }
            var hasCost = (hint.Cost ?? 0) > 0;

            var user = await _context.Users
                .Include(u => u.Team)
                .FirstOrDefaultAsync(u => u.Id == userId);

            // If unauthenticated/null user and hint has cost, keep the old behavior: locked.
            if (user == null && hasCost)
            {
                return new HintResponseDTO
                {
                    Id = hint.Id,
                    Type = hint.Type,
                    ChallengeId = hint.ChallengeId,
                    Cost = hint.Cost,
                    View = "locked"
                };
            }
            var view = "unlocked";
            if (hasCost)
            {
                view = "locked";

                if (user != null)
                {
                    Unlock? unlocked;
                    if (_configHelper.IsTeamsMode())
                    {
                        unlocked = user.TeamId == null
                            ? null
                            : await _context.Unlocks
                                .AsNoTracking()
                                .FirstOrDefaultAsync(u =>
                                    u.TeamId == user.TeamId &&
                                    u.Target == hint.Id &&
                                    (u.Type == HintUnlockType || u.Type == null));
                    }
                    else
                    {
                        unlocked = await _context.Unlocks
                            .AsNoTracking()
                            .FirstOrDefaultAsync(u =>
                                u.UserId == user.Id &&
                                u.Target == hint.Id &&
                                (u.Type == HintUnlockType || u.Type == null));
                    }

                    if (unlocked != null)
                    {
                        view = "unlocked";
                    }
                }
            }
            return new HintResponseDTO
            {
                Id = hint.Id,
                Type = hint.Type,
                ChallengeId = hint.ChallengeId,
                Cost = hint.Cost,
                Content = view != "locked" ? hint.Content : null,
                Html = view != "locked" && hint.Content != null ? $"<p>{hint.Content}</p>\n" : null,
                Requirements = hint.Requirements,
                View = view
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId, data: new { hintId = id });
            return null;
        }
    }

    public async Task<HintListDTO?> GetHintsByChallengeId(int challengeId, int user)
    {
        try
        {
            var challenge = await _context.Challenges.FirstOrDefaultAsync(c => c.Id == challengeId);
            if (challenge == null) return null;
            if (!challenge.State.Equals("visible"))
            {
                return null;
            }

            var hints = await _context.Hints
                .AsNoTracking()
                .Where(h => h.ChallengeId == challengeId)
                .ToListAsync();

            var hintIds = hints.Select(h => h.Id).ToList();
            var unlockedHintIds = new HashSet<int>();

            if (hintIds.Count > 0)
            {
                var currentUser = await _context.Users
                    .AsNoTracking()
                    .FirstOrDefaultAsync(u => u.Id == user);

                if (currentUser != null)
                {
                    var unlocksQuery = _context.Unlocks
                        .AsNoTracking()
                        .Where(u =>
                            u.Target != null &&
                            hintIds.Contains(u.Target.Value) &&
                            (u.Type == HintUnlockType || u.Type == null));

                    if (_configHelper.IsTeamsMode())
                    {
                        if (currentUser.TeamId != null)
                        {
                            unlocksQuery = unlocksQuery.Where(u => u.TeamId == currentUser.TeamId);
                            var unlocked = await unlocksQuery
                                .Select(u => u.Target!.Value)
                                .ToListAsync();
                            unlockedHintIds = new HashSet<int>(unlocked);
                        }
                    }
                    else
                    {
                        unlocksQuery = unlocksQuery.Where(u => u.UserId == currentUser.Id);
                        var unlocked = await unlocksQuery
                            .Select(u => u.Target!.Value)
                            .ToListAsync();
                        unlockedHintIds = new HashSet<int>(unlocked);
                    }
                }
            }

            return new HintListDTO
            {
                Size = hints.Count,
                Hints = hints.Select(h => new HintSummaryDTO
                {
                    Id = h.Id,
                    Cost = h.Cost,
                    IsUnlocked = (h.Cost ?? 0) <= 0 || unlockedHintIds.Contains(h.Id)
                }).ToList()
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, user, data: new { challengeId });
            return null;
        }
    }

    public async Task<UnlockResponseDTO?> UnlockHint(UnlockRequestDto req, int userId)
    {
        try
        {
            var target = await _context.Hints
                .Include(h => h.Challenge)
                .FirstOrDefaultAsync(h => h.Id == req.Target);

            if (target == null) return null;
            if (target.Challenge == null) return null;
            if (!target.Challenge.State.Equals("visible"))
            {
                return null;
            }

            var user = await _context.Users
                .Include(u => u.Team)
                .FirstOrDefaultAsync(u => u.Id == userId);

            if (user == null)
                throw new InvalidOperationException("User not found");

            // Use distributed lock to prevent race condition across multiple backend replicas
            // Lock key is based on team/user to allow parallel unlocks for different teams
            var lockKey = _configHelper.IsTeamsMode()
                ? $"hint:unlock:team:{user.TeamId}"
                : $"hint:unlock:user:{user.Id}";
            var lockToken = Guid.NewGuid().ToString();
            var lockExpiry = TimeSpan.FromSeconds(30); // Max time to complete unlock operation

            bool acquired = await _redisLockHelper.AcquireLock(lockKey, lockToken, lockExpiry);
            if (!acquired)
                throw new InvalidOperationException("Another unlock operation is in progress. Please try again.");

            try
            {
                await EnsureChallengePrerequisitesUnlockedAsync(target.Challenge, user);

                // Re-check prerequisites inside lock to avoid TOCTOU
                var prerequisites = GetPrerequisites(target.Requirements);
                if (prerequisites.Count > 0)
                {
                    IQueryable<Unlock> allUnlocksQuery = _context.Unlocks.Where(u => u.Type == HintUnlockType);
                    if (_configHelper.IsTeamsMode())
                    {
                        if (user.TeamId == null)
                            throw new InvalidOperationException("User team not found");
                        allUnlocksQuery = allUnlocksQuery.Where(u => u.TeamId == user.TeamId);
                    }
                    else
                    {
                        allUnlocksQuery = allUnlocksQuery.Where(u => u.UserId == user.Id);
                    }

                    var allUnlocks = await allUnlocksQuery
                        .Select(u => u.Target)
                        .ToListAsync();
                    var unlockIds = new HashSet<int>(allUnlocks.Where(t => t.HasValue).Select(t => t.Value));

                    var freeHints = await _context.Hints
                        .Where(h => h.Cost == null || h.Cost == 0)
                        .Select(h => h.Id)
                        .ToListAsync();
                    var freeIds = new HashSet<int>(freeHints);

                    unlockIds.UnionWith(freeIds);

                    var allHintIds = await _context.Hints
                        .Select(h => h.Id)
                        .ToListAsync();
                    var allHintIdsSet = new HashSet<int>(allHintIds);

                    var prereqs = new HashSet<int>(prerequisites);
                    prereqs.IntersectWith(allHintIdsSet);

                    if (!prereqs.IsSubsetOf(unlockIds))
                    {
                        throw new InvalidOperationException("You must unlock other hints before accessing this hint");
                    }
                }

                // Check if already unlocked based on mode (Team Mode or User Mode)
                Unlock? existing;
                if (_configHelper.IsTeamsMode())
                {
                    // Team Mode: Check by TeamId
                    existing = await _context.Unlocks
                        .FirstOrDefaultAsync(u => u.Target == req.Target && u.Type == req.Type && u.TeamId == user.TeamId);
                }
                else
                {
                    // User Mode: Check by UserId
                    existing = await _context.Unlocks
                        .FirstOrDefaultAsync(u => u.Target == req.Target && u.Type == req.Type && u.UserId == user.Id);
                }

                if (existing != null)
                    throw new InvalidOperationException("Already unlocked");

                // Check score inside lock to prevent TOCTOU race
                var userCheck = await _context.Users
                    .AsNoTracking()
                    .Include(u => u.Team)
                    .FirstOrDefaultAsync(u => u.Id == user.Id);
                if (userCheck?.Team == null)
                    throw new InvalidOperationException("User team not found");

                var score = await _scoreHelper.GetTeamScore(userCheck.Team, admin: true);

                if (target.Cost != null && target.Cost > score)
                    throw new InvalidOperationException("Not enough points to unlock this hint");

                var unlock = new Unlock
                {
                    Target = req.Target,
                    Type = req.Type,
                    UserId = user.Id,
                    TeamId = user.TeamId,
                    Date = DateTime.UtcNow
                };
                _context.Unlocks.Add(unlock);

                var award = new Award
                {
                    UserId = user.Id,
                    TeamId = user.TeamId,
                    Name = "Hint " + target.ChallengeId,
                    Description = "Hint for " + target.Challenge.Name,
                    Value = -target.Cost.GetValueOrDefault(),
                    Category = "hint",
                    Date = DateTime.UtcNow
                };
                _context.Awards.Add(award);

                await _context.SaveChangesAsync();

                return new UnlockResponseDTO
                {
                    Id = unlock.Id,
                    Type = unlock.Type,
                    Target = unlock.Target,
                    TeamId = unlock.TeamId,
                    UserId = unlock.UserId,
                    Date = unlock.Date
                };
            }
            finally
            {
                // Always release lock, even if operation fails
                await _redisLockHelper.ReleaseLock(lockKey, lockToken);
            }
        }
        catch (InvalidOperationException)
        {
            // Bubble up business errors for controller to return 400
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId, data: new { target = req.Target, type = req.Type });
            throw;
        }
    }
}

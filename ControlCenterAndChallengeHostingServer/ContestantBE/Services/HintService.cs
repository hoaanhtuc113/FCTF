using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Hint;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.Security.Claims;

namespace ContestantBE.Services
{
    public class HintService : IHintService
    {
        private readonly AppDbContext _context;
        private readonly ScoreHelper _scoreHelper;
        private readonly ConfigHelper _configHelper;

        public HintService(AppDbContext context, ScoreHelper scoreHelper, ConfigHelper configHelper)
        {
            _context = context;
            _scoreHelper = scoreHelper;
            _configHelper = configHelper;
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

        public async Task<HintResponseDTO?> GetHintById(int id, int? userId, bool preview)
        {
            var hint = await _context.Hints.Include(h => h.Challenge).FirstOrDefaultAsync(h => h.Id == id);
            if (hint == null) return null;
            if (!hint.Challenge.State.Equals("visible"))
            {
                return null;
            }
            var prerequisites = GetPrerequisites(hint.Requirements);
            var user = await _context.Users
                                         .Include(u => u.Team)
                                         .FirstOrDefaultAsync(u => u.Id == userId);
            // Nếu user null và có cost hoặc yêu cầu
            if (user == null && (hint.Cost != null && prerequisites.Count > 0))
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

            string view = "unlocked";

            // Nếu có cost > 0 và user chưa unlock
            if (hint.Cost > 0)
            {
                view = "locked";
                var unlocked = await _context.Unlocks
                    .FirstOrDefaultAsync(u => u.UserId == user.Id && u.Target == hint.Id);
                if (unlocked != null) view = "unlocked";
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

        public async Task<HintListDTO?> GetHintsByChallengeId(int challengeId, int user)
        {
            var challenge = await _context.Challenges.FirstOrDefaultAsync(c => c.Id == challengeId);
            if (challenge == null) return null;
            if (!challenge.State.Equals("visible"))
            {
                return null;
            }
            var hints = await _context.Hints.Where(h => h.ChallengeId == challengeId).ToListAsync();
            return new HintListDTO
            {
                Size = hints.Count,
                Hints = hints.Select(h => new HintSummaryDTO
                {
                    Id = h.Id,
                    Cost = h.Cost
                }).ToList()
            };
        }

        public async Task<UnlockResponseDTO?> UnlockHint(UnlockRequestDto req, int userId)
        {
            var target = await _context.Hints.Include(h => h.Challenge).FirstOrDefaultAsync(h => h.Id == req.Target);
            if (target == null) return null;
            if (!target.Challenge.State.Equals("visible"))
            {
                return null;
            }
            var user = await _context.Users
                                         .Include(u => u.Team)
                                         .FirstOrDefaultAsync(u => u.Id == userId);
            // Check prerequisites
            var prerequisites = GetPrerequisites(target.Requirements);
            if (prerequisites.Count > 0)
            {
                // Get the IDs of all hints that the user has unlocked
                var allUnlocks = await _context.Unlocks
                    .Where(u => u.UserId == user.Id && u.Type == "hints")
                    .Select(u => u.Target)
                    .ToListAsync();
                var unlockIds = new HashSet<int>(allUnlocks.Where(t => t.HasValue).Select(t => t.Value));

                // Get the IDs of all free hints (cost = 0 or null)
                var freeHints = await _context.Hints
                    .Where(h => h.Cost == null || h.Cost == 0)
                    .Select(h => h.Id)
                    .ToListAsync();
                var freeIds = new HashSet<int>(freeHints);

                // Add free hints to unlocked IDs
                unlockIds.UnionWith(freeIds);

                // Filter out hint IDs that don't exist
                var allHintIds = await _context.Hints
                    .Select(h => h.Id)
                    .ToListAsync();
                var allHintIdsSet = new HashSet<int>(allHintIds);
                
                var prereqs = new HashSet<int>(prerequisites);
                prereqs.IntersectWith(allHintIdsSet);

                // Check if user has unlocked all required hints
                if (!prereqs.IsSubsetOf(unlockIds))
                {
                    throw new InvalidOperationException("You must unlock other hints before accessing this hint");
                }
            }

            var userCheck = await _context.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == user.Id);
            var score = await _scoreHelper.GetTeamScore(userCheck.Team, admin: true);

            if (target.Cost != null && target.Cost > score)
                throw new InvalidOperationException("Not enough points to unlock this hint");

            // Check if already unlocked based on mode (Team Mode or User Mode)
            Unlock? existing;
            if (_configHelper.IsTeamsMode())
            {
                Console.WriteLine("Team mode");
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
    }
}

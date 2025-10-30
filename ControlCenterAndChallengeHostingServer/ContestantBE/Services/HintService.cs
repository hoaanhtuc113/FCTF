using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Hint;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace ContestantBE.Services
{
    public class HintService : IHintService
    {
        private readonly AppDbContext _context;
        private readonly ScoreHelper _scoreHelper;

        public HintService(AppDbContext context, ScoreHelper scoreHelper)
        {
            _context = context;
            _scoreHelper = scoreHelper;
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
                            result.Add(value);
                    }
                }
            }
            catch { }
            return result;
        }

        public async Task<HintResponseDTO?> GetHintById(int id, User? user, bool preview)
        {
            var hint = await _context.Hints.FindAsync(id);
            if (hint == null) return null;

            var prerequisites = GetPrerequisites(hint.Requirements);

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

        public async Task<HintListDTO> GetHintsByChallengeId(int challengeId, User user)
        {
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

        public async Task<UnlockResponseDTO?> UnlockHint(UnlockRequestDto req, User user)
        {
            var target = await _context.Hints.Include(h => h.Challenge).FirstOrDefaultAsync(h => h.Id == req.Target);
            if (target == null) return null;

            var userCheck = await _context.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == user.Id);
            var score = await _scoreHelper.GetTeamScore(userCheck.Team, admin: true);

            if (target.Cost != null && target.Cost > score)
                throw new InvalidOperationException("Not enough points to unlock this hint");

            var existing = await _context.Unlocks
                .FirstOrDefaultAsync(u => u.Target == req.Target && u.Type == req.Type && u.UserId == user.Id);
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

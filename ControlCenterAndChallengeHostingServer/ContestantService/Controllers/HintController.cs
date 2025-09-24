using ContestantService.Extensions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Hint;
using ResourceShared.DTOs.Team;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.Text.Json;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class HintController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly CtfTimeHelper _ctfTimeHelper;
        private readonly ConfigHelper _configHelper;
        private readonly ScoreHelper _scoreHelper;
        public HintController(AppDbContext context, CtfTimeHelper ctfTimeHelper, ConfigHelper configHelper, ScoreHelper scoreHelper)
        {
            _context = context;
            _ctfTimeHelper = ctfTimeHelper;
            _configHelper = configHelper;
            _scoreHelper = scoreHelper;
        }
        private List<int> GetPrerequisites(string? requirementsJson)
        {
            var result = new List<int>();

            if (string.IsNullOrWhiteSpace(requirementsJson))
                return result;

            try
            {
                using var doc = JsonDocument.Parse(requirementsJson);
                if (doc.RootElement.TryGetProperty("prerequisites", out var prereqElement)
                    && prereqElement.ValueKind == JsonValueKind.Array)
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
            catch (JsonException)
            {
                
            }

            return result;
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetHintById(int id)
        {
            var user = HttpContext.GetCurrentUser();
            var hint = await _context.Hints.FindAsync(id);
            if (user == null)
            {
                if(hint.Cost != null && GetPrerequisites(hint.Requirements).Count > 0)
                {
                    return StatusCode(403, new
                    {
                        success = false,
                        errors = new
                        {
                            cost = new[] { "You must login to unlock this hint" }
                        }
                    });
                }
            }

            var prerequisites = GetPrerequisites(hint.Requirements);
            if(prerequisites.Count > 0)
            {
                var allUnlocks = _context.Unlocks
                                .Where(u => u.UserId == user.Id)
                                .Select(u => u.Target)
                                .ToHashSet();

                // Lấy tất cả free hints
                var freeIds = _context.Hints
                    .Where(h => h.Cost == 0)
                    .Select(h => h.Id)
                    .ToHashSet();

                // Add free hints vào unlocks
                allUnlocks.UnionWith(freeIds.Select(id => (int?)id));

                // Lấy toàn bộ hint IDs trong hệ thống để filter
                var allHintIds = _context.Hints.Select(h => h.Id).ToHashSet();

                // Chỉ giữ các id tồn tại
                var prereqSet = prerequisites.Intersect(allHintIds).ToHashSet();

                // Nếu chưa unlock đủ và không phải admin → chặn
                if (!(allUnlocks.IsSupersetOf(prereqSet.Select(id => (int?)id)) || user.Type == "admin"))
                {
                    return StatusCode(403, new
                    {
                        success = false,
                        errors = new
                        {
                            requirements = new[] { "You must unlock other hints before accessing this hint" }
                        }
                    });
                }
            }
            string view = "unlocked";
            if (hint.Cost != null && hint.Cost > 0)
            {
                view = "locked";

                var unlocked = await _context.Unlocks
                    .FirstOrDefaultAsync(u => u.UserId == user.Id && u.Target == hint.Id);

                if (unlocked != null)
                {
                    view = "unlocked";
                }
            }

            // Case admin preview
            if (user.Type == "admin" && Request.Query.ContainsKey("preview"))
            {
                view = "admin";
            }

            object data = view switch
            {
                "locked" => new
                {
                    id = hint.Id,
                    type = hint.Type,
                    challenge = hint.ChallengeId,
                    challenge_id = hint.ChallengeId,
                    cost = hint.Cost
                },
                "unlocked" => new
                {
                    id = hint.Id,
                    type = hint.Type,
                    challenge = hint.ChallengeId,
                    challenge_id = hint.ChallengeId,
                    cost = hint.Cost,
                    content = hint.Content,
                    html = hint.Content != null ? $"<p>{hint.Content}</p>\n" : null
                },
                "admin" => new
                {
                    id = hint.Id,
                    type = hint.Type,
                    challenge = hint.ChallengeId,
                    challenge_id = hint.ChallengeId,
                    cost = hint.Cost,
                    content = hint.Content,
                    html = hint.Content != null ? $"<p>{hint.Content}</p>\n" : null,
                    requirements = hint.Requirements
                },
                _ => throw new InvalidOperationException("Invalid view")
            };
        

            return Ok(new { success = true, data });

        }
        [HttpGet("{id}/all")]
        public async Task<IActionResult> GetHintByChallengeId(int id)
        {
            var user = HttpContext.GetCurrentUser();
            if(user == null)
            {
                return Unauthorized(new { success = false, message = "Unauthorized: Invalid token" });
            }
            var hints = await _context.Hints.Where(h => h.ChallengeId == id).ToListAsync();
            var data = new
            {
                size = hints.Count,
                hints = hints.Select(h => new
                {
                    id = h.Id,
                    cost = h.Cost
                }).ToList()
            };

            return Ok(new { success = true, hints = data });

        }

        [HttpPost("unlock")]
        public async Task<IActionResult> PostUnlock([FromBody] UnlockRequestDto req)
        {
            var user = HttpContext.GetCurrentUser();
            if (user == null)
            {
                return Unauthorized(new { success = false, message = "Unauthorized" });
            }

            req.TeamId = user.TeamId;
            req.UserId = user.Id;

            var target = await _context.Hints.Include(h=>h.Challenge).FirstOrDefaultAsync(h => h.Id == req.Target);
            if (target == null)
            {
                return NotFound(new { message = "Target not found" });
            }
            User userCheck = await _context.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == user.Id);
            
            var score = await _scoreHelper.GetTeamScore(userCheck.Team, admin: true); 
            if (target.Cost!=null && target.Cost > score)
            {
                return StatusCode(400, new
                {
                    success = false,
                    errors = new { score = "You do not have enough points to unlock this hint" }
                });
            }

            
            var existing = await _context.Unlocks
                .FirstOrDefaultAsync(u =>
                    u.Target == req.Target &&
                    u.Type == req.Type &&
                    u.UserId == user.Id);

            if (existing != null)
            {
                return StatusCode(400, new
                {
                    success = false,
                    errors = new { target = "You've already unlocked this target" }
                });
            }

            
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
                Name = "Hint "+target.ChallengeId,  
                Description = "Hint for " +  target.Challenge.Name, 
                Value = -target.Cost.GetValueOrDefault(),
                Category = "hint",
                Date = DateTime.UtcNow,
            };
            _context.Awards.Add(award);

            await _context.SaveChangesAsync();

            return Ok(new
            {
                success = true,
                data = new
                {
                    unlock.Id,
                    unlock.Type,
                    unlock.Target,
                    unlock.TeamId,
                    unlock.UserId,
                    unlock.Date
                }
            });
        }


    }
}

using ContestantBE.Attribute;
using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Hint;
using ResourceShared.Logger;
using ResourceShared.Models;
using System.Security.Claims;
using static ResourceShared.Enums;

namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class HintController : ControllerBase
    {
        private readonly IHintService _hintService;
        private readonly AppDbContext _context;
        private readonly AppLogger _userBehaviorLogger;

        public HintController(IHintService hintService, AppDbContext context, AppLogger userBehaviorLogger)
        {
            _hintService = hintService;
            _context = context;
            _userBehaviorLogger = userBehaviorLogger;
        }

        [HttpGet("{id}")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetHintById(int id, [FromQuery] bool preview = false)
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

            _userBehaviorLogger.Log(
                "GET_HINT",
                userId,
                int.Parse(User.FindFirstValue("teamId")!),
                new { hint_id = id, preview = preview });

            var hint = await _hintService.GetHintById(id, userId, preview);
            if (hint == null) return NotFound(new { message = "Hint not found" });
            return Ok(new { success = true, data = hint });
        }

        [HttpGet("{id}/all")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetHintByChallengeId(int id)
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));

            _userBehaviorLogger.Log("GET_HINTS_BY_CHALLENGE", userId, int.Parse(User.FindFirstValue("teamId")), new { challenge_id = id });
            var data = await _hintService.GetHintsByChallengeId(id, userId);
            return Ok(new { success = true, hints = data });
        }

        [HttpPost("unlock")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> PostUnlock([FromBody] UnlockRequestDto req)
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));
            var teamId = int.Parse(User.FindFirstValue("teamId"));

            if (teamId == 0 || userId == 0)
            {
                return Unauthorized(new { success = false, error = "Permission denied" });
            }
            try
            {

                var target = await _context.Hints.Include(h => h.Challenge).FirstOrDefaultAsync(h => h.Id == req.Target);

                if (target == null || target.Challenge == null)
                {
                    return BadRequest(new { success = false, error = "Invalid challenge or hint" });
                }

                _userBehaviorLogger.Log("UNLOCK_HINT", userId, teamId, new { hint_id = req.Target, challenge_id = target.Challenge.Id });

                if (target.Challenge.State == ChallengeState.HIDDEN)
                {
                    return BadRequest(new { success = false, error = "Challenge is hidden" });
                }

                var solve = await _context.Solves.FirstOrDefaultAsync(s => s.ChallengeId == target.Challenge.Id && s.TeamId == teamId);

                if (solve != null)
                {
                    return BadRequest(new { success = false, error = "Challenge already solved" });
                }

                await Console.Out.WriteLineAsync($"[Requesst Unlock Hint Challenge] User {userId} : Team {teamId} : Challenge {target.Challenge.Name}");

                var result = await _hintService.UnlockHint(req, userId);
                return Ok(new { success = true, data = result });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }
    }
}

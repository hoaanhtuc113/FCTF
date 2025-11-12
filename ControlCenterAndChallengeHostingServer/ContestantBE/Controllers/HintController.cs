using ContestantBE.Attribute;
using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.Attribute;
using ResourceShared.DTOs.Hint;
using ResourceShared.Extensions;
using System.Security.Claims;

namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class HintController : ControllerBase
    {
        private readonly IHintService _hintService;

        public HintController(IHintService hintService)
        {
            _hintService = hintService;
        }

        [HttpGet("{id}")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetHintById(int id, [FromQuery] bool preview = false)
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));
            var hint = await _hintService.GetHintById(id, userId, preview);
            if (hint == null) return NotFound(new { message = "Hint not found" });
            return Ok(new { success = true, data = hint });
        }

        [HttpGet("{id}/all")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetHintByChallengeId(int id)
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));
            var data = await _hintService.GetHintsByChallengeId(id, userId);
            return Ok(new { success = true, hints = data });
        }

        [HttpPost("unlock")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> PostUnlock([FromBody] UnlockRequestDto req)
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));

            try
            {
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

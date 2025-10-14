using ContestantService.Attribute;
using ContestantService.Extensions;
using ContestantService.Interfaces;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.Hint;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
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
            var user = HttpContext.GetCurrentUser();
            var hint = await _hintService.GetHintById(id, user, preview);
            if (hint == null) return NotFound(new { message = "Hint not found" });
            return Ok(new { success = true, data = hint });
        }

        [HttpGet("{id}/all")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetHintByChallengeId(int id)
        {
            var user = HttpContext.GetCurrentUser();
            if (user == null) return Unauthorized(new { message = "Unauthorized" });
            var data = await _hintService.GetHintsByChallengeId(id, user);
            return Ok(new { success = true, hints = data });
        }

        [HttpPost("unlock")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> PostUnlock([FromBody] UnlockRequestDto req)
        {
            var user = HttpContext.GetCurrentUser();
            if (user == null) return Unauthorized(new { success = false, message = "Unauthorized" });

            try
            {
                var result = await _hintService.UnlockHint(req, user);
                return Ok(new { success = true, data = result });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }
    }
}

using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class TeamController : ControllerBase
    {
        private readonly ITeamService _teamService;

        public TeamController(ITeamService teamService)
        {
            _teamService = teamService;
        }

        //[HttpPost("create")]
        //public async Task<IActionResult> CreateTeam([FromBody] CreateTeamRequestDTO request)
        //{
        //    var user = HttpContext.GetCurrentUser();
        //    if (user == null) return Unauthorized(new { success = false, message = "You must log in first" });

        //    var result = await _teamService.CreateTeam(request, user);
        //    if (!result.Success) return BadRequest(new { success = false, message = result.Message });

        //    return Created("", new { success = true, team = result.Data });
        //}

        //[HttpPost("join")]
        //public async Task<IActionResult> JoinTeam([FromBody] JoinTeamRequestDTO request)
        //{
        //    var user = HttpContext.GetCurrentUser();
        //    if (user == null) return Unauthorized(new { success = false, message = "You must log in first" });

        //    var result = await _teamService.JoinTeam(request, user);
        //    if (!result.Success) return BadRequest(new { success = false, message = result.Message });

        //    return Ok(new { success = true, message = result.Message });
        //}

        [HttpGet("contestant")]
        [Authorize]
        public async Task<IActionResult> GetScoreTeam()
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

            var teamScore = await _teamService.GetTeamScore(userId);
            if (teamScore == null) return NotFound(new { success = false, message = "Team not found" });

            return Ok(new { success = true, data = teamScore });
        }

        [HttpGet("solves")]
        [Authorize]
        public async Task<IActionResult> GetSolvesTeam()
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

            var solves = await _teamService.GetTeamSolves(userId);
            return Ok(new { success = true, data = solves, meta = new { count = solves.Count } });
        }
    }
}

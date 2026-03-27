using ContestantBE.Interfaces;
using ContestantBE.Utils;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ContestantBE.Controllers;

[Authorize]
public class TeamController : BaseController
{
    private readonly ITeamService _teamService;

    public TeamController(
        IUserContext userContext,
        ITeamService teamService) : base(userContext)
    {
        _teamService = teamService;
    }

    [HttpGet("contestant")]
    public async Task<IActionResult> GetScoreTeam()
    {
        var userId = UserContext.UserId;
        var teamScore = await _teamService.GetTeamScore(userId);
        if (teamScore == null) return NotFound(new { success = false, message = "Team not found" });

        return Ok(new { success = true, data = teamScore });
    }

    [HttpGet("solves")]
    public async Task<IActionResult> GetSolvesTeam()
    {
        var userId = UserContext.UserId;

        var solves = await _teamService.GetTeamSolves(userId);
        return Ok(new { success = true, data = solves, meta = new { count = solves.Count } });
    }
}

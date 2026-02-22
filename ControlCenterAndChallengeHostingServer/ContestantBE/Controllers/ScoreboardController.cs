using ContestantBE.Interfaces;
using ContestantBE.Utils;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;

namespace ContestantBE.Controllers;

public class ScoreboardController : BaseController
{
    private readonly IScoreboardService _scoreboardService;

    public ScoreboardController(
        IUserContext userContext,
        IScoreboardService scoreboardService) : base(userContext)
    {
        _scoreboardService = scoreboardService;
    }

    [HttpGet("top/{count:int}")]
    [OutputCache(Duration = 60)]
    public async Task<IActionResult> GetTopTeams(int count, [FromQuery] int? bracket_id)
    {
        var result = await _scoreboardService.GetTopStandings(count, bracket_id);
        return Ok(new { success = true, data = result });
    }
}

using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.Utils;

namespace ContestantBE.Controllers;

public class ScoreboardController : BaseController
{
    private readonly IScoreboardService _scoreboardService;
    private readonly ConfigHelper _configHelper;

    public ScoreboardController(
        IUserContext userContext,
        IScoreboardService scoreboardService,
        ConfigHelper configHelper) : base(userContext)
    {
        _scoreboardService = scoreboardService;
        _configHelper = configHelper;
    }

    [HttpGet("top/{count:int}")]
    public async Task<IActionResult> GetTopTeams(int count, [FromQuery] int? bracket_id)
    {
        var scoreVisibility = _configHelper.GetConfig<string>("score_visibility", "public");

        switch (scoreVisibility)
        {
            case "public":
                // Everyone can view — no auth required
                break;
            case "private":
                // Require authenticated user
                if (!(User.Identity?.IsAuthenticated ?? false))
                    return Unauthorized(new { success = false, message = "Scores are private. Please log in to view the scoreboard." });
                break;
            case "hidden":
            case "admins":
                return StatusCode(403, new { success = false, message = "Scores are currently hidden." });
        }

        var result = await _scoreboardService.GetTopStandings(count, bracket_id);
        return Ok(new { success = true, data = result });
    }
}


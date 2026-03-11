using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace ContestantBE.Controllers;

public class ScoreboardController : BaseController
{
    private readonly IScoreboardService _scoreboardService;
    private readonly ConfigHelper _configHelper;
    private readonly AppDbContext _context;

    public ScoreboardController(
        IUserContext userContext,
        IScoreboardService scoreboardService,
        ConfigHelper configHelper,
        AppDbContext context) : base(userContext)
    {
        _scoreboardService = scoreboardService;
        _configHelper = configHelper;
        _context = context;
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
                // If bracket_view_other is disabled, restrict to user's own bracket
                if (!_configHelper.GetConfig<bool>("bracket_view_other"))
                {
                    var team = await _context.Teams.FindAsync(UserContext.TeamId);
                    bracket_id = team?.BracketId;
                }
                break;
            case "hidden":
                return StatusCode(403, new { success = false, message = "Scores are currently hidden." });
        }

        var result = await _scoreboardService.GetTopStandings(count, bracket_id);
        return Ok(new { success = true, data = result });
    }

    [HttpGet("brackets")]
    public async Task<IActionResult> GetBrackets()
    {
        var scoreVisibility = _configHelper.GetConfig<string>("score_visibility", "public");
        var bracketViewOther = _configHelper.GetConfig<bool>("bracket_view_other");

        if (scoreVisibility == "private" && !bracketViewOther)
            return Ok(new { success = true, data = Array.Empty<object>() });

        var brackets = await _context.Brackets
            .Select(b => new { b.Id, b.Name, b.Description, b.Type })
            .ToListAsync();

        return Ok(new { success = true, data = brackets });
    }

    [AllowAnonymous]
    [HttpGet("freeze-status")]
    public IActionResult GetFreezeStatus()
    {
        var freezeRaw = _configHelper.GetConfig("freeze");
        long freeze = 0;
        if (freezeRaw != null)
            long.TryParse(freezeRaw.ToString(), out freeze);

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var isFrozen = freeze > 0 && now >= freeze;

        return Ok(new
        {
            success = true,
            is_frozen = isFrozen,
            freeze_time = freeze > 0 ? (long?)freeze : null
        });
    }
}


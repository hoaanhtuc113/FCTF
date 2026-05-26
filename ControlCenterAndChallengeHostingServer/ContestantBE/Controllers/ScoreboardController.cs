using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace ContestantBE.Controllers;

[Route("api/contest/{contestId}/[controller]")]
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
    public async Task<IActionResult> GetTopTeams([FromRoute] int contestId, int count, [FromQuery] int? bracket_id)
    {
        var contest = await _context.Contests.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == contestId);
        if (contest == null)
            return NotFound(new { success = false, message = "Contest not found." });

        switch (contest.ScoreVisibility)
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
                    var userId = UserContext.UserId;
                    var user = await _context.Users
                        .Include(u => u.TeamMemberships).ThenInclude(m => m.Team)
                        .AsNoTracking()
                        .FirstOrDefaultAsync(u => u.Id == userId);
                    var team = GetUserTeamForContest(user, contestId);
                    bracket_id = team?.BracketId;
                }
                break;
            case "hidden":
                return StatusCode(403, new { success = false, message = "Scores are currently hidden." });
        }

        var result = await _scoreboardService.GetTopStandings(contestId, count, bracket_id);
        return Ok(new { success = true, data = result });
    }

    [HttpGet("brackets")]
    public async Task<IActionResult> GetBrackets([FromRoute] int contestId)
    {
        var contest = await _context.Contests.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == contestId);
        if (contest == null)
            return NotFound(new { success = false, message = "Contest not found." });

        var bracketViewOther = _configHelper.GetConfig<bool>("bracket_view_other");

        if (contest.ScoreVisibility == "private" && !bracketViewOther)
            return Ok(new { success = true, data = Array.Empty<object>() });

        var brackets = await _context.Brackets
            .Select(b => new { b.Id, b.Name, b.Description, b.Type })
            .ToListAsync();

        return Ok(new { success = true, data = brackets });
    }

    [AllowAnonymous]
    [HttpGet("freeze-status")]
    public async Task<IActionResult> GetFreezeStatus([FromRoute] int contestId)
    {
        var contest = await _context.Contests.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == contestId);
        if (contest == null)
            return NotFound(new { success = false, message = "Contest not found." });

        long freeze = contest.FreezeScoreboardAt.HasValue
            ? new DateTimeOffset(contest.FreezeScoreboardAt.Value, TimeSpan.Zero).ToUnixTimeSeconds()
            : 0;

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


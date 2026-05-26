using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ContestantBE.Controllers;

[Route("api/contests")]
[Authorize]
public class ContestsController : BaseController
{
    private readonly AppDbContext _dbContext;

    public ContestsController(
        IUserContext userContext,
        AppDbContext dbContext) : base(userContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>
    /// Returns all contests the authenticated user can see and belongs to.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetContests()
    {
        var userId = UserContext.UserId;

        var contests = await _dbContext.Contests
            .Where(c =>
                (c.State != "hidden" || c.Participants.Any(p => p.UserId == userId))
                && c.Teams.Any(t => t.Members.Any(m => m.UserId == userId)))
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                slug = c.Slug,
                description = c.Description,
                state = c.State,
                start_time = c.StartTime,
                end_time = c.EndTime,
                team_count = c.Teams.Count,
                challenge_count = c.Challenges.Count(ch => ch.State == "visible"),
                category = "CTF",
                my_team_id = (int?)c.Teams
                    .Where(t => t.Members.Any(m => m.UserId == userId))
                    .Select(t => t.Id)
                    .FirstOrDefault(),
                my_team_name = c.Teams
                    .Where(t => t.Members.Any(m => m.UserId == userId))
                    .Select(t => t.Name)
                    .FirstOrDefault()
            })
            .ToListAsync();

        var now = DateTime.UtcNow;

        return Ok(contests.Select(c => new
        {
            c.id,
            c.name,
            c.slug,
            c.description,
            status = ComputeStatus(c.state, c.start_time, c.end_time, now),
            start_time = c.start_time?.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            end_time = c.end_time?.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            c.team_count,
            c.challenge_count,
            c.category,
            c.my_team_id,
            c.my_team_name
        }));
    }

    /// <summary>
    /// Returns details for a single contest the user belongs to.
    /// </summary>
    [HttpGet("{contestId:int}")]
    public async Task<IActionResult> GetContest([FromRoute] int contestId)
    {
        var userId = UserContext.UserId;

        var c = await _dbContext.Contests
            .Where(c => c.Id == contestId
                && (c.State != "hidden" || c.Participants.Any(p => p.UserId == userId))
                && c.Teams.Any(t => t.Members.Any(m => m.UserId == userId)))
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                slug = c.Slug,
                description = c.Description,
                state = c.State,
                start_time = c.StartTime,
                end_time = c.EndTime,
                team_count = c.Teams.Count,
                challenge_count = c.Challenges.Count(ch => ch.State == "visible"),
                category = "CTF",
                my_team_id = (int?)c.Teams
                    .Where(t => t.Members.Any(m => m.UserId == userId))
                    .Select(t => t.Id)
                    .FirstOrDefault(),
                my_team_name = c.Teams
                    .Where(t => t.Members.Any(m => m.UserId == userId))
                    .Select(t => t.Name)
                    .FirstOrDefault(),
                view_after_ctf = c.ViewAfterCtf,
                freeze_scoreboard_at = c.FreezeScoreboardAt,
                score_visibility = c.ScoreVisibility
            })
            .FirstOrDefaultAsync();

        if (c == null)
            return NotFound(new { error = "Contest not found" });

        var now = DateTime.UtcNow;

        return Ok(new
        {
            c.id,
            c.name,
            c.slug,
            c.description,
            status = ComputeStatus(c.state, c.start_time, c.end_time, now),
            start_time = c.start_time?.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            end_time = c.end_time?.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            c.team_count,
            c.challenge_count,
            c.category,
            c.my_team_id,
            c.my_team_name,
            c.view_after_ctf,
            freeze_scoreboard_at = c.freeze_scoreboard_at?.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            c.score_visibility
        });
    }

    /// <summary>
    /// Returns whether the contest is currently accessible (running, or ended with view_after_ctf).
    /// </summary>
    [HttpGet("{contestId:int}/access")]
    public async Task<IActionResult> GetContestAccess([FromRoute] int contestId)
    {
        var contest = await _dbContext.Contests
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == contestId);

        if (contest == null)
            return NotFound(new { error = "Contest not found" });

        var now = DateTime.UtcNow;
        bool isRunning = contest.State != "paused" && contest.State != "ended" &&
            (contest.StartTime == null || now >= contest.StartTime) &&
            (contest.EndTime == null || now <= contest.EndTime);
        bool ended = contest.State is "ended" or "paused" ||
            (contest.EndTime.HasValue && now > contest.EndTime.Value);
        bool canAccess = isRunning || (ended && contest.ViewAfterCtf);

        string reason;
        if (isRunning)
            reason = "active";
        else if (ended && contest.ViewAfterCtf)
            reason = "ended_view_allowed";
        else if (ended)
            reason = "ended";
        else
            reason = "not_started";

        return Ok(new { isSuccess = true, canAccess, reason });
    }

    private static string ComputeStatus(string? state, DateTime? startTime, DateTime? endTime, DateTime now)
    {
        if (state is "paused" or "ended")
            return "ended";
        if (startTime == null || endTime == null)
            return "active";
        if (now < startTime)
            return "upcoming";
        if (now >= startTime && now <= endTime)
            return "active";
        return "ended";
    }
}

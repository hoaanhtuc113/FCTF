using ContestantBE.Interfaces;
using ContestantBE.Utils;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ContestantBE.Controllers;

[Authorize]
[Route("api/contest/{contestId}/[controller]")]
public class TeamController : BaseController
{
    private readonly ITeamService _teamService;
    private readonly AppDbContext _dbContext;

    public TeamController(
        IUserContext userContext,
        ITeamService teamService,
        AppDbContext dbContext) : base(userContext)
    {
        _teamService = teamService;
        _dbContext = dbContext;
    }

    [HttpGet("contestant")]
    public async Task<IActionResult> GetScoreTeam([FromRoute] int contestId)
    {
        var userId = UserContext.UserId;
        var teamScore = await _teamService.GetTeamScore(userId, contestId);
        if (teamScore == null) return NotFound(new { success = false, message = "Team not found" });

        return Ok(new { success = true, data = teamScore });
    }

    [HttpGet("solves")]
    public async Task<IActionResult> GetSolvesTeam([FromRoute] int contestId)
    {
        var userId = UserContext.UserId;

        var solves = await _teamService.GetTeamSolves(userId, contestId);
        return Ok(new { success = true, data = solves, meta = new { count = solves.Count } });
    }

    /// <summary>
    /// Rename the current user's team (captain only, requires allow_name_change on the contest).
    /// </summary>
    [HttpPut("name")]
    public async Task<IActionResult> RenameTeam([FromRoute] int contestId, [FromBody] RenameTeamRequest request)
    {
        if (string.IsNullOrWhiteSpace(request?.Name))
            return BadRequest(new { success = false, message = "Team name cannot be empty." });

        var newName = request.Name.Trim();
        if (newName.Length > 128)
            return BadRequest(new { success = false, message = "Team name must be 128 characters or fewer." });

        var contest = await _dbContext.Contests.AsNoTracking().FirstOrDefaultAsync(c => c.Id == contestId);
        if (contest == null)
            return NotFound(new { success = false, message = "Contest not found." });

        if (!contest.AllowNameChange)
            return StatusCode(403, new { success = false, message = "Team name changes are not allowed in this contest." });

        var userId = UserContext.UserId;
        var team = await _dbContext.Teams
            .FirstOrDefaultAsync(t => t.ContestId == contestId && t.Members.Any(m => m.UserId == userId));

        if (team == null)
            return NotFound(new { success = false, message = "Team not found." });

        if (team.CaptainUserId != userId)
            return StatusCode(403, new { success = false, message = "Only the team captain can rename the team." });

        // Check name uniqueness within this contest
        var nameExists = await _dbContext.Teams
            .AsNoTracking()
            .AnyAsync(t => t.ContestId == contestId && t.Id != team.Id && t.Name == newName);
        if (nameExists)
            return Conflict(new { success = false, message = "A team with that name already exists in this contest." });

        team.Name = newName;
        await _dbContext.SaveChangesAsync();

        return Ok(new { success = true, message = "Team name updated successfully.", name = team.Name });
    }

    /// <summary>
    /// Disband the current user's team (captain only, requires team_disbanding on the contest).
    /// </summary>
    [HttpDelete("disband")]
    public async Task<IActionResult> DisbandTeam([FromRoute] int contestId)
    {
        var contest = await _dbContext.Contests.AsNoTracking().FirstOrDefaultAsync(c => c.Id == contestId);
        if (contest == null)
            return NotFound(new { success = false, message = "Contest not found." });

        if (!contest.TeamDisbanding)
            return StatusCode(403, new { success = false, message = "Team disbanding is not allowed in this contest." });

        var userId = UserContext.UserId;
        var team = await _dbContext.Teams
            .Include(t => t.Members)
            .FirstOrDefaultAsync(t => t.ContestId == contestId && t.Members.Any(m => m.UserId == userId));

        if (team == null)
            return NotFound(new { success = false, message = "Team not found." });

        if (team.CaptainUserId != userId)
            return StatusCode(403, new { success = false, message = "Only the team captain can disband the team." });

        _dbContext.Teams.Remove(team);
        await _dbContext.SaveChangesAsync();

        return Ok(new { success = true, message = "Team has been disbanded." });
    }
}

public record RenameTeamRequest(string Name);

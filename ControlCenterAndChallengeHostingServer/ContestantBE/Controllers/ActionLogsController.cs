using ContestantBE.Interfaces;
using ContestantBE.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.ActionLogs;
using ResourceShared.Models;

namespace ContestantBE.Controllers;

[Authorize]
[Route("api/contest/{contestId}/[controller]")]
public class ActionLogsController : BaseController
{
    private readonly IActionLogsServices _actionLogsServices;
    private readonly AppDbContext _context;

    public ActionLogsController(
        IUserContext userContext,
        IActionLogsServices actionLogsServices,
        AppDbContext context) : base(userContext)
    {
        _actionLogsServices = actionLogsServices;
        _context = context;
    }

    [HttpGet("get-logs-team")]
    public async Task<IActionResult> GetActionLogsTeam([FromRoute] int contestId)
    {
        var userId = UserContext.UserId;
        var user = await _context.Users
            .Include(u => u.TeamMemberships).ThenInclude(m => m.Team)
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId);
        var team = GetUserTeamForContest(user, contestId);
        if (team == null)
            return NotFound(new { success = false, message = "Team not found for this contest" });

        var teamId = team.Id;
        var logs_with_details = await _actionLogsServices.GetActionLogsTeam(teamId, contestId);

        if (logs_with_details == null || logs_with_details.Count == 0)
        {
            return Ok(new
            {
                success = false,
                message = "No action logs found."
            });
        }
        return Ok(new
        {
            success = true,
            data = logs_with_details
        });
    }
}

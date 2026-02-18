using ContestantBE.Interfaces;
using ContestantBE.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.ActionLogs;

namespace ContestantBE.Controllers;

[Authorize]
public class ActionLogsController : BaseController
{
    private readonly IActionLogsServices _actionLogsServices;

    public ActionLogsController(
        IUserContext userContext,
        IActionLogsServices actionLogsServices) : base(userContext)
    {
        _actionLogsServices = actionLogsServices;
    }

    [HttpGet("get-logs")]
    public async Task<IActionResult> GetActionLogs()
    {
        var logs_with_details = await _actionLogsServices.GetActionLogs();

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

    [HttpGet("get-logs-team")]
    public async Task<IActionResult> GetActionLogsTeam()
    {
        var teamId = UserContext.TeamId;
        var logs_with_details = await _actionLogsServices.GetActionLogsTeam(teamId);

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

    [HttpPost("save-logs")]
    public async Task<IActionResult> PostActionLogs([FromBody] ActionLogsReq req)
    {
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }
        var userId = UserContext.UserId;

        if (req.ChallengeId <= 0)
        {
            return BadRequest(new
            {
                success = false,
                message = "Invalid request data"
            });
        }

        var log = await _actionLogsServices.SaveActionLogs(req, userId);
        return Ok(new
        {
            success = true,
            data = log,
        });
    }
}

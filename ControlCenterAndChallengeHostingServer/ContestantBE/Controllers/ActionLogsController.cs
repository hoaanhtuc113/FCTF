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

    [HttpPost("save-logs")]
    public async Task<IActionResult> SaveActionLogs([FromBody] ActionLogsReq req)
    {
        var userId = UserContext.UserId;
        try
        {
            var log = await _actionLogsServices.SaveActionLogs(req, userId);
            return Ok(new { success = true, data = log });
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"[ActionLog] Save failed: {ex.Message}");
            return StatusCode(500, new { success = false, message = "Failed to save action log." });
        }
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
}

using ContestantBE.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.ActionLogs;
using System.Security.Claims;

namespace ContestantBE.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class ActionLogsController : ControllerBase
{
    private readonly IActionLogsServices _actionLogsServices;

    public ActionLogsController(IActionLogsServices actionLogsServices)
    {
        _actionLogsServices = actionLogsServices;
    }

    [HttpGet("get-logs")]
    public async Task<IActionResult> GetActionLogs()
    {
        try
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
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                error = ex.Message
            });
        }
    }

    [HttpGet("get-logs-team")]
    public async Task<IActionResult> GetActionLogsTeam()
    {
        try
        {
            var teamId = int.Parse(User.FindFirstValue("teamId"));
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
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                error = ex.Message
            });
        }
    }

    [HttpPost("save-logs")]
    public async Task<IActionResult> PostActionLogs([FromBody] ActionLogsReq req)
    {
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (req.ChallengeId <= 0)
        {
            return BadRequest(new
            {
                success = false,
                message = "Invalid request data"
            });
        }

        try
        {
            if (int.TryParse(id, out var userId))
            {
                var log = await _actionLogsServices.SaveActionLogs(req, userId);
                return Ok(new
                {
                    success = true,
                    data = log,
                });
            }
            return BadRequest(new
            {
                success = false,
                message = "Invalid user ID"
            });

        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                error = ex.Message
            });
        }
    }
}

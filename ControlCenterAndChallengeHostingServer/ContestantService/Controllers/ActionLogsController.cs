using ContestantService.Extensions;
using ContestantService.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.ActionLogs;
using ResourceShared.Models;
using System.Net;
using System.Net.WebSockets;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [RequireAuth]
    public class ActionLogsController : ControllerBase
    {
        private IActionLogsServices _actionLogsServices;

        public ActionLogsController(IActionLogsServices actionLogsServices)
        {
            _actionLogsServices = actionLogsServices;
        }

        [HttpGet("get-logs")]
        public async Task<IActionResult> GetActionLogs()
        {
            try { 
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

        [HttpPost("save-logs")]
        public async Task<IActionResult> PostActionLogs([FromBody] ActionLogsReq req)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }
            var user = HttpContext.GetCurrentUser();
            if (user == null)
            {
                return NotFound(new
                {
                    success = false,
                    message = "User not found"
                });
            }

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
                var log = await _actionLogsServices.SaveActionLogs(req, user.Id);
                return Ok(new
                {
                    success = true,
                    data = log,
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
}

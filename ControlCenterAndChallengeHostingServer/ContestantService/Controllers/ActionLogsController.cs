using ContestantService.Extensions;
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
    [Route("api/action_logs")]
    [ApiController]
    public class ActionLogsController : ControllerBase
    {
        private AppDbContext _context;

        public ActionLogsController(AppDbContext context)
        {
            _context = context;
        }

        [HttpGet]
        public async Task<IActionResult> GetActionLogs()
        {
            try { 
                var logs_with_details = await _context.ActionLogs.Include(al => al.User).OrderByDescending(x => x.ActionDate)
                                                        .Select(al => new
                                                        {
                                                            al.ActionId,
                                                            al.ActionType,
                                                            al.ActionDate,
                                                            al.ActionDetail,
                                                            al.TopicName,
                                                            al.UserId,
                                                            UserName = al.User != null ? al.User.Name : ""
                                                        })
                                                        .ToListAsync();

                if (logs_with_details == null || logs_with_details.Count == 0)
                {
                    return NotFound(new
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

        [HttpPost]
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
                var topic_name = await _context.Challenges
                                            .Where(c => c.Id == req.ChallengeId)
                                            .Select(c => c.Category)
                                            .FirstOrDefaultAsync();

                var challenge = await _context.Challenges
                                            .Where(c => c.Id == req.ChallengeId)
                                            .FirstOrDefaultAsync();
                var challenge_name = challenge != null ? challenge.Name : "Unknown";

                var log = new ActionLog
                {
                    ActionType = req.ActionType,
                    ActionDetail = req.ActionDetail,
                    ActionDate = DateTime.UtcNow,
                    UserId = user.Id,
                    TopicName = topic_name ?? "Null",
                };
                _context.ActionLogs.Add(log);
                await _context.SaveChangesAsync();

                var logs_with_usernames = await _context.ActionLogs.Include(al => al.User)
                                                            .Where(al => al.UserId == user.Id)
                                                            .OrderByDescending(x => x.ActionDate)
                                                            .Select(al => new
                                                            {
                                                                al.ActionId,
                                                                al.ActionType,
                                                                al.ActionDate,
                                                                al.ActionDetail,
                                                                al.TopicName,
                                                                al.UserId,
                                                                UserName = al.User != null ? al.User.Name : ""
                                                            })
                                                            .ToListAsync();
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

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using System.Threading.Tasks;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class NotificationsController : ControllerBase
    {
        private AppDbContext _context;

        public NotificationsController(AppDbContext context)
        {
            _context = context;
        }

        [HttpGet]
        public async Task<IActionResult> GetNotifications()
        {
            try
            {
                var notifications = await _context.Notifications.ToListAsync();
                var data = notifications.Select(n => new
                {
                    n.Id,
                    n.Content,
                    n.Title,
                    n.Date,
                    user_id = n.UserId,
                    n.User,
                    team_id = n.TeamId,
                    n.Team,
                    html = n.Content,
                });
                return Ok(new
                {
                    success = true,
                    data = data
                });
            }
            catch (System.Exception ex)
            {
                return BadRequest(new
                {
                    success = false,
                    errors = ex.Message
                });
            }
        }
    }
}

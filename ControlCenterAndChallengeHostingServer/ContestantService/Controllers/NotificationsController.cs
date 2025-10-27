using ContestantService.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Notification;
using ResourceShared.Models;
using System.Threading.Tasks;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [RequireAuth]
    public class NotificationsController : ControllerBase
    {
        private INotificationServices _notification;

        public NotificationsController(INotificationServices notification)
        {
           _notification = notification;
        }

        [HttpGet]
        public async Task<IActionResult> GetNotifications()
        {
            try
            {
                var data = await _notification.GetAll();

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

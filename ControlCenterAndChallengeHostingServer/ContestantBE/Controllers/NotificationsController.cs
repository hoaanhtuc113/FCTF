using ContestantBE.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class NotificationsController : ControllerBase
    {
        private readonly INotificationServices _notification;

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

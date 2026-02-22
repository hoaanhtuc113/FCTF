using ContestantBE.Interfaces;
using ContestantBE.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ContestantBE.Controllers;

[Authorize]
public class NotificationsController : BaseController
{
    private readonly INotificationServices _notification;

    public NotificationsController(
        IUserContext userContext,
        INotificationServices notification) : base(userContext)
    {
        _notification = notification;
    }

    [HttpGet]
    public async Task<IActionResult> GetNotifications()
    {
        var data = await _notification.GetAll();

        return Ok(new
        {
            success = true,
            data
        });
    }
}

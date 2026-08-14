using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.Logger;

namespace ContestantBE.Controllers;

[Authorize]
[Route("api/contest/{contestId}/[controller]")]
public class NotificationController : BaseController
{
    private readonly INotificationService _notificationService;
    private readonly AppLogger _userBehaviorLogger;

    public NotificationController(
        IUserContext userContext,
        INotificationService notificationService,
        AppLogger userBehaviorLogger) : base(userContext)
    {
        _notificationService = notificationService;
        _userBehaviorLogger = userBehaviorLogger;
    }

    [HttpGet("notifications-user")]
    public async Task<IActionResult> GetNotificationsByUser(
        [FromRoute] int contestId,
        [FromQuery] int page = 1,
        [FromQuery] int per_page = 20)
    {
        var userId = UserContext.UserId;
        var result = await _notificationService.GetNotificationsByUser(userId, contestId, page, per_page);
        return Ok(result);
    }

    [HttpGet("unread-count")]
    public async Task<IActionResult> GetUnreadCount([FromRoute] int contestId)
    {
        var userId = UserContext.UserId;
        var count = await _notificationService.GetUnreadCount(userId, contestId);
        return Ok(new { unread_count = count });
    }

    [HttpPost("{notificationId}/read")]
    public async Task<IActionResult> MarkAsRead([FromRoute] int contestId, int notificationId)
    {
        var userId = UserContext.UserId;
        _userBehaviorLogger.Log("READ_NOTIFICATION", userId, null, new { notification_id = notificationId }, contestId: contestId);

        var result = await _notificationService.MarkAsRead(notificationId, userId, contestId);
        if (!result.Success) return BadRequest(new { message = result.Message });

        return Ok(new { message = result.Message });
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllAsRead([FromRoute] int contestId)
    {
        var userId = UserContext.UserId;
        var result = await _notificationService.MarkAllAsRead(contestId, userId);
        if (!result.Success) return BadRequest(new { message = result.Message });

        return Ok(new { message = result.Message, count = result.Data });
    }
}

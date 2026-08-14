namespace ContestantBE.Services;

using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Notification;
using ResourceShared.Logger;
using ResourceShared.Models;

public class NotificationService : INotificationService
{
    private readonly AppDbContext _context;
    private readonly AppLogger _logger;

    public NotificationService(AppDbContext context, AppLogger logger)
    {
        _context = context;
        _logger = logger;
    }

    /// <summary>
    /// A contestant belongs to at most one team per contest, so this is the
    /// single id every "is this notification for me" check resolves against
    /// alongside the user's own id.
    /// </summary>
    private async Task<int?> GetUserTeamId(int userId, int contestId)
    {
        return await (from utm in _context.UserTeamMembers
                       join t in _context.Teams on utm.TeamId equals t.Id
                       where utm.UserId == userId && t.ContestId == contestId
                       select (int?)t.Id)
                      .FirstOrDefaultAsync();
    }

    private IQueryable<ResourceShared.Models.Notification> VisibleNotifications(int userId, int contestId, int? teamId)
    {
        return _context.Notifications
            .Where(n => n.ContestId == contestId)
            .Where(n => _context.NotificationRecipients.Any(r =>
                r.NotificationId == n.Id &&
                (r.UserId == userId || (teamId != null && r.TeamId == teamId))));
    }

    public async Task<PaginatedNotificationsDTO> GetNotificationsByUser(int userId, int contestId, int page, int perPage)
    {
        try
        {
            page = Math.Max(page, 1);
            perPage = Math.Clamp(perPage, 1, 100);

            var teamId = await GetUserTeamId(userId, contestId);
            var baseQuery = VisibleNotifications(userId, contestId, teamId);

            var total = await baseQuery.CountAsync();
            var unreadCount = await baseQuery
                .Where(n => !_context.NotificationReads.Any(rd => rd.NotificationId == n.Id && rd.UserId == userId))
                .CountAsync();

            var notifications = await (
                from n in baseQuery
                join a in _context.Users on n.AuthorId equals a.Id into authorJoin
                from a in authorJoin.DefaultIfEmpty()
                join rd in _context.NotificationReads.Where(x => x.UserId == userId)
                    on n.Id equals rd.NotificationId into readJoin
                from rd in readJoin.DefaultIfEmpty()
                orderby n.CreatedAt descending
                select new NotificationResponseDTO
                {
                    Id = n.Id,
                    Title = n.Title,
                    Content = n.Content,
                    TargetType = n.TargetType,
                    AuthorName = a != null ? a.Name : null,
                    CreatedAt = n.CreatedAt,
                    IsRead = rd != null,
                    ReadAt = rd != null ? rd.ReadAt : (DateTime?)null,
                })
                .Skip((page - 1) * perPage)
                .Take(perPage)
                .AsNoTracking()
                .ToListAsync();

            return new PaginatedNotificationsDTO { Notifications = notifications, Total = total, UnreadCount = unreadCount };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId, contestId: contestId);
            return new PaginatedNotificationsDTO { Notifications = [], Total = 0, UnreadCount = 0 };
        }
    }

    public async Task<int> GetUnreadCount(int userId, int contestId)
    {
        try
        {
            var teamId = await GetUserTeamId(userId, contestId);
            return await VisibleNotifications(userId, contestId, teamId)
                .Where(n => !_context.NotificationReads.Any(rd => rd.NotificationId == n.Id && rd.UserId == userId))
                .CountAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId, contestId: contestId);
            return 0;
        }
    }

    public async Task<BaseResponseDTO<bool>> MarkAsRead(int notificationId, int userId, int contestId)
    {
        try
        {
            var notification = await _context.Notifications.AsNoTracking()
                .FirstOrDefaultAsync(n => n.Id == notificationId && n.ContestId == contestId);
            if (notification == null)
                return BaseResponseDTO<bool>.Fail("Notification not found");

            var teamId = await GetUserTeamId(userId, contestId);
            var isRecipient = await _context.NotificationRecipients.AnyAsync(r =>
                r.NotificationId == notificationId && (r.UserId == userId || (teamId != null && r.TeamId == teamId)));
            if (!isRecipient)
                return BaseResponseDTO<bool>.Fail("You don't have permission to view this notification");

            var alreadyRead = await _context.NotificationReads
                .AnyAsync(r => r.NotificationId == notificationId && r.UserId == userId);
            if (!alreadyRead)
            {
                _context.NotificationReads.Add(new NotificationRead
                {
                    NotificationId = notificationId,
                    UserId = userId,
                    ReadAt = DateTime.UtcNow,
                });
                await _context.SaveChangesAsync();
            }

            return BaseResponseDTO<bool>.Ok(true, "Marked as read");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId, data: new { notificationId }, contestId: contestId);
            return BaseResponseDTO<bool>.Fail("An error occurred while marking notification as read");
        }
    }

    public async Task<BaseResponseDTO<int>> MarkAllAsRead(int contestId, int userId)
    {
        try
        {
            var teamId = await GetUserTeamId(userId, contestId);
            var unreadIds = await VisibleNotifications(userId, contestId, teamId)
                .Where(n => !_context.NotificationReads.Any(rd => rd.NotificationId == n.Id && rd.UserId == userId))
                .Select(n => n.Id)
                .ToListAsync();

            foreach (var id in unreadIds)
            {
                _context.NotificationReads.Add(new NotificationRead
                {
                    NotificationId = id,
                    UserId = userId,
                    ReadAt = DateTime.UtcNow,
                });
            }
            if (unreadIds.Count > 0)
                await _context.SaveChangesAsync();

            return BaseResponseDTO<int>.Ok(unreadIds.Count, "Marked all as read");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId, contestId: contestId);
            return BaseResponseDTO<int>.Fail("An error occurred while marking notifications as read");
        }
    }
}

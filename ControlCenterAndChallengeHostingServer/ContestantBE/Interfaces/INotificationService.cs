using ResourceShared.DTOs;
using ResourceShared.DTOs.Notification;

namespace ContestantBE.Interfaces;

public interface INotificationService
{
    Task<PaginatedNotificationsDTO> GetNotificationsByUser(int userId, int contestId, int page, int perPage);
    Task<int> GetUnreadCount(int userId, int contestId);
    Task<BaseResponseDTO<bool>> MarkAsRead(int notificationId, int userId, int contestId);
    Task<BaseResponseDTO<int>> MarkAllAsRead(int contestId, int userId);
}

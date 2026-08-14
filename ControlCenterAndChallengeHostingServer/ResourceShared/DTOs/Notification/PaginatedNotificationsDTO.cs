using System.Collections.Generic;

namespace ResourceShared.DTOs.Notification
{
    public class PaginatedNotificationsDTO
    {
        public List<NotificationResponseDTO> Notifications { get; set; } = new();
        public int Total { get; set; }
        public int UnreadCount { get; set; }
    }
}

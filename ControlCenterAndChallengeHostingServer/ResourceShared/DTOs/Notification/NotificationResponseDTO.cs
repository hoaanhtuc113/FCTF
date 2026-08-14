using System;

namespace ResourceShared.DTOs.Notification
{
    public class NotificationResponseDTO
    {
        public int Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Content { get; set; } = string.Empty;
        public string TargetType { get; set; } = string.Empty;
        public string? AuthorName { get; set; }
        public DateTime CreatedAt { get; set; }
        public bool IsRead { get; set; }
        public DateTime? ReadAt { get; set; }
    }
}

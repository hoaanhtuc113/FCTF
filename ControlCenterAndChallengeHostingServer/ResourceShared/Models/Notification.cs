using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Notification
{
    public int Id { get; set; }

    public int ContestId { get; set; }

    public int? AuthorId { get; set; }

    public string Title { get; set; } = null!;

    public string Content { get; set; } = null!;

    public string TargetType { get; set; } = "user";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public virtual Contest Contest { get; set; } = null!;

    public virtual User? Author { get; set; }

    public virtual ICollection<NotificationRecipient> Recipients { get; set; } = new List<NotificationRecipient>();

    public virtual ICollection<NotificationRead> Reads { get; set; } = new List<NotificationRead>();
}

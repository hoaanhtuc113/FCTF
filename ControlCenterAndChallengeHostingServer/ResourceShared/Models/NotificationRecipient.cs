using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class NotificationRecipient
{
    public int Id { get; set; }

    public int NotificationId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public virtual Notification Notification { get; set; } = null!;

    public virtual User? User { get; set; }

    public virtual Team? Team { get; set; }
}

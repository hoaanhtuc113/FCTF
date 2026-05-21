using System;

namespace ResourceShared.Models;

public partial class Achievement
{
    public int Id { get; set; }

    public int? TeamId { get; set; }

    public int AwardBadgeId { get; set; }

    public DateTime Date { get; set; } = DateTime.UtcNow;

    public virtual AwardBadge AwardBadge { get; set; } = null!;

    public virtual Team? Team { get; set; }
}

using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Achievement
{
    public int Id { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public int? ChallengeId { get; set; }

    public string? Name { get; set; }

    public int? AchievementId { get; set; }

    public virtual AwardBadge? AchievementNavigation { get; set; }

    public virtual Challenge? Challenge { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

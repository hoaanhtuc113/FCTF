using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class AwardBadge
{
    public int Id { get; set; }

    public string? Name { get; set; }

    public int? ChallengeId { get; set; }

    public virtual Challenge? Challenge { get; set; }

    public virtual ICollection<Achievement> Achievements { get; set; } = new List<Achievement>();
}

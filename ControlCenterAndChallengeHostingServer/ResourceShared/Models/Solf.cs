using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Solf
{
    public int Id { get; set; }

    public int? ChallengeId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public virtual Challenge? Challenge { get; set; }

    public virtual Submission IdNavigation { get; set; } = null!;

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

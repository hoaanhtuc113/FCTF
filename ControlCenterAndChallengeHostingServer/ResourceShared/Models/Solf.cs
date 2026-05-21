using System;

namespace ResourceShared.Models;

public partial class Solf
{
    public int Id { get; set; }

    public int? ContestChallengeId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public virtual ContestChallenge? ContestChallenge { get; set; }

    public virtual Submission IdNavigation { get; set; } = null!;

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

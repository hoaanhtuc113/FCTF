using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

/// <summary>
/// Badge/huy hiệu gắn với một contest challenge instance.
/// Table: award_badges
/// FK đã đổi: challenge_id (challenges.id) → contest_challenge_id (contests_challenges.id)
/// </summary>
public partial class AwardBadge
{
    public int Id { get; set; }

    public int? ContestId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    /// <summary>FK → contests_challenges.id</summary>
    public int? ContestChallengeId { get; set; }

    public string? Name { get; set; }

    public virtual ICollection<Achievement> Achievements { get; set; } = new List<Achievement>();

    public virtual Contest? Contest { get; set; }

    public virtual ContestsChallenge? ContestChallenge { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

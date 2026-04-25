using System;

namespace ResourceShared.Models;

/// <summary>
/// Thành tích của user/team trong một contest challenge.
/// Table: achievements
/// FK đã đổi: challenge_id (challenges.id) → contest_challenge_id (contests_challenges.id)
/// </summary>
public partial class Achievement
{
    public int Id { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    /// <summary>FK → contests_challenges.id</summary>
    public int? ContestChallengeId { get; set; }

    public string? Name { get; set; }

    public int? AchievementId { get; set; }

    /// <summary>FK → contests.id</summary>
    public int? ContestId { get; set; }

    public virtual AwardBadge? AchievementNavigation { get; set; }

    public virtual Contest? Contest { get; set; }

    public virtual ContestsChallenge? ContestChallenge { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

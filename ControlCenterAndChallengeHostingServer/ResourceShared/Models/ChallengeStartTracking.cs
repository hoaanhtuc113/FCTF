using System;

namespace ResourceShared.Models;

/// <summary>
/// Theo dõi thời điểm start/stop challenge của user/team trong một contest.
/// Table: challenge_start_tracking
/// FK đã đổi: challenge_id (challenges.id) → contest_challenge_id (contests_challenges.id)
/// </summary>
public partial class ChallengeStartTracking
{
    public int Id { get; set; }

    public int? ContestId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    /// <summary>FK → contests_challenges.id</summary>
    public int ContestChallengeId { get; set; }

    public DateTime StartedAt { get; set; }

    public DateTime? StoppedAt { get; set; }

    public string? Label { get; set; }

    public virtual Contest? Contest { get; set; }

    public virtual ContestsChallenge ContestChallenge { get; set; } = null!;

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

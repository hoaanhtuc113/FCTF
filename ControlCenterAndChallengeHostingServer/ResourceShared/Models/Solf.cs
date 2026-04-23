using System;

namespace ResourceShared.Models;

/// <summary>
/// Solve thành công. Inherits từ Submission.
/// Table: solves
/// Unique constraint đã đổi: (challenge_id, user_id) → (contest_challenge_id, user_id)
/// </summary>
public partial class Solf
{
    public int Id { get; set; }

    public int ContestId { get; set; }

    /// <summary>FK → contests_challenges.id</summary>
    public int ContestChallengeId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public virtual Contest Contest { get; set; } = null!;

    public virtual ContestsChallenge ContestChallenge { get; set; } = null!;

    public virtual Submission IdNavigation { get; set; } = null!;

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

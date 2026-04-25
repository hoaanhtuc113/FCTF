using System;

namespace ResourceShared.Models;

/// <summary>
/// Mỗi lần submit flag. Scoped theo contest_id và contest_challenge_id.
/// Table: submissions
/// FK đã đổi: challenge_id (challenges.id) → contest_challenge_id (contests_challenges.id)
/// Thêm: contest_id FK → contests.id
/// </summary>
public partial class Submission
{
    public int Id { get; set; }

    /// <summary>FK → contests.id</summary>
    public int ContestId { get; set; }

    /// <summary>FK → contests_challenges.id (instance trong contest)</summary>
    public int ContestChallengeId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public string? Ip { get; set; }

    public string? Provided { get; set; }

    public string? Type { get; set; }

    public DateTime? Date { get; set; } = DateTime.UtcNow;

    public virtual Contest Contest { get; set; } = null!;

    public virtual ContestsChallenge ContestChallenge { get; set; } = null!;

    public virtual Solf? Solf { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

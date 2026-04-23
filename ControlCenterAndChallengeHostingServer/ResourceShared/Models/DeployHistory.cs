using System;

namespace ResourceShared.Models;

/// <summary>
/// Lịch sử deploy của một contest challenge instance.
/// Table: deploy_histories
/// FK đã đổi: challenge_id (challenges.id) → contest_challenge_id (contests_challenges.id)
/// </summary>
public partial class DeployHistory
{
    public int Id { get; set; }

    /// <summary>FK → contests_challenges.id (instance trong contest, không phải bank)</summary>
    public int ContestChallengeId { get; set; }

    public string? LogContent { get; set; }

    public string DeployStatus { get; set; } = null!;

    public DateTime? DeployAt { get; set; }

    public virtual ContestsChallenge ContestChallenge { get; set; } = null!;
}

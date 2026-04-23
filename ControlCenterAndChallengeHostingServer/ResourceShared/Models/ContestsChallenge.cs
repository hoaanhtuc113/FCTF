using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

/// <summary>
/// Instance của một challenge trong một contest cụ thể.
/// Table: contests_challenges
///
/// Mối quan hệ:
///   BankId  → challenges.id  (template gốc)
///   ContestId → contests.id
///
/// Tất cả dữ liệu runtime (submissions, solves, deploy histories,
/// start tracking, comments) đều FK vào ContestChallengeId (id của bảng này).
/// </summary>
public partial class ContestsChallenge
{
    public int Id { get; set; }

    public int ContestId { get; set; }

    /// <summary>FK → challenges.id (bank template)</summary>
    public int? BankId { get; set; }

    // --- Override / runtime fields ---

    public string? Name { get; set; }

    public string? ConnectionInfo { get; set; }

    /// <summary>Self-reference: chuỗi challenge trong contest</summary>
    public int? NextId { get; set; }

    public int? MaxAttempts { get; set; } = 0;

    public int? Value { get; set; }

    /// <summary>visible | hidden</summary>
    public string State { get; set; } = "visible";

    public int? TimeLimit { get; set; }

    public DateTime? StartTime { get; set; }

    public DateTime? TimeFinished { get; set; }

    public int? Cooldown { get; set; } = 0;

    public bool RequireDeploy { get; set; } = false;

    public string? DeployStatus { get; set; } = "CREATED";

    public DateTime? LastUpdate { get; set; }

    public int? MaxDeployCount { get; set; } = 0;

    /// <summary>http | tcp | ...</summary>
    public string? ConnectionProtocol { get; set; } = "http";

    /// <summary>FK → users.id (người deploy)</summary>
    public int? UserId { get; set; }

    // Navigation properties
    public virtual Contest Contest { get; set; } = null!;

    public virtual Challenge? BankChallenge { get; set; }

    public virtual ContestsChallenge? Next { get; set; }

    public virtual ICollection<ContestsChallenge> InverseNext { get; set; } = new List<ContestsChallenge>();

    public virtual User? Creator { get; set; }

    public virtual ICollection<Submission> Submissions { get; set; } = new List<Submission>();

    public virtual ICollection<Solf> Solves { get; set; } = new List<Solf>();

    public virtual ICollection<DeployHistory> DeployHistories { get; set; } = new List<DeployHistory>();

    public virtual ICollection<ChallengeStartTracking> StartTrackings { get; set; } = new List<ChallengeStartTracking>();

    public virtual ICollection<Achievement> Achievements { get; set; } = new List<Achievement>();

    public virtual ICollection<AwardBadge> AwardBadges { get; set; } = new List<AwardBadge>();
}

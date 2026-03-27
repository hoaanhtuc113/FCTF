using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Challenge
{
    public int Id { get; set; }

    public string? Name { get; set; }

    public string? Description { get; set; }

    public int? MaxAttempts { get; set; }

    public int? Value { get; set; }

    public string? Category { get; set; }

    public string? Type { get; set; }

    public string State { get; set; } = null!;

    public string? Requirements { get; set; }

    public string? ConnectionInfo { get; set; }

    public int? NextId { get; set; }

    public int? TimeLimit { get; set; }

    public bool RequireDeploy { get; set; }

    public string? DeployStatus { get; set; }

    public DateTime? LastUpdate { get; set; }

    public DateTime? TimeFinished { get; set; }

    public DateTime? StartTime { get; set; }

    public string? ImageLink { get; set; }

    public int UserId { get; set; }

    public int? Cooldown { get; set; }

    public int? CpuLimit { get; set; }

    public int? CpuRequest { get; set; }

    public int? MemoryLimit { get; set; }

    public int? MemoryRequest { get; set; }

    public bool? UseGvisor { get; set; }

    public bool? HardenContainer { get; set; }

    public int? MaxDeployCount { get; set; }

    public int? Difficulty { get; set; }

    public bool SharedInstant { get; set; }

    public virtual ICollection<Achievement> Achievements { get; set; } = new List<Achievement>();

    public virtual ICollection<AwardBadge> AwardBadges { get; set; } = new List<AwardBadge>();

    public virtual ICollection<ChallengeTopic> ChallengeTopics { get; set; } = new List<ChallengeTopic>();

    public virtual ICollection<Comment> Comments { get; set; } = new List<Comment>();

    public virtual ICollection<DeployHistory> DeployHistories { get; set; } = new List<DeployHistory>();

    public virtual ICollection<ChallengeStartTracking> ChallengeStartTrackings { get; set; } = new List<ChallengeStartTracking>();

    public virtual DynamicChallenge? DynamicChallenge { get; set; }

    public virtual ICollection<File> Files { get; set; } = new List<File>();

    public virtual ICollection<Flag> Flags { get; set; } = new List<Flag>();

    public virtual ICollection<Hint> Hints { get; set; } = new List<Hint>();

    public virtual ICollection<Challenge> InverseNext { get; set; } = new List<Challenge>();

    public virtual MultipleChoiceChallenge? MultipleChoiceChallenge { get; set; }

    public virtual Challenge? Next { get; set; }

    public virtual ICollection<Solf> Solves { get; set; } = new List<Solf>();

    public virtual ICollection<Submission> Submissions { get; set; } = new List<Submission>();

    public virtual ICollection<Tag> Tags { get; set; } = new List<Tag>();

    public virtual User User { get; set; } = null!;
}

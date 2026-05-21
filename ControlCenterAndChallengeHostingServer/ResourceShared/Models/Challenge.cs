using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Challenge
{
    public int Id { get; set; }

    public string? Name { get; set; }

    public string? Description { get; set; }

    public string? Category { get; set; }

    public string? Type { get; set; }

    public int? Difficulty { get; set; }

    public bool RequireDeploy { get; set; }

    public string? DeployStatus { get; set; }

    public string? ImageLink { get; set; }

    public string? ConnectionInfo { get; set; }

    public string ConnectionProtocol { get; set; } = "http";

    public int? CpuLimit { get; set; }

    public int? CpuRequest { get; set; }

    public int? MemoryLimit { get; set; }

    public int? MemoryRequest { get; set; }

    public bool? UseGvisor { get; set; }

    public bool? HardenContainer { get; set; }

    public bool SharedInstant { get; set; }

    public DateTime? LastUpdate { get; set; }

    public int? CreatedBy { get; set; }

    public virtual User? Creator { get; set; }

    public virtual ICollection<AwardBadge> AwardBadges { get; set; } = new List<AwardBadge>();

    public virtual ICollection<ChallengeTopic> ChallengeTopics { get; set; } = new List<ChallengeTopic>();

    public virtual ICollection<ContestChallenge> ContestChallenges { get; set; } = new List<ContestChallenge>();

    public virtual ICollection<DeployHistory> DeployHistories { get; set; } = new List<DeployHistory>();

    public virtual ICollection<ChallengeVersion> Versions { get; set; } = new List<ChallengeVersion>();

    public virtual DynamicChallenge? DynamicChallenge { get; set; }

    public virtual ICollection<File> Files { get; set; } = new List<File>();

    public virtual ICollection<Flag> Flags { get; set; } = new List<Flag>();

    public virtual ICollection<Hint> Hints { get; set; } = new List<Hint>();

    public virtual MultipleChoiceChallenge? MultipleChoiceChallenge { get; set; }

    public virtual ICollection<Tag> Tags { get; set; } = new List<Tag>();
}

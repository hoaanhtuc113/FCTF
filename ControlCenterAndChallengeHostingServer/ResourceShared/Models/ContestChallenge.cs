using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class ContestChallenge
{
    public int Id { get; set; }

    public int ContestId { get; set; }

    public int ChallengeTemplateId { get; set; }

    public int? TemplateVersionId { get; set; }

    public int? Value { get; set; }

    public string State { get; set; } = "hidden";

    public int? MaxAttempts { get; set; }

    public int? Cooldown { get; set; }

    public int? TimeLimit { get; set; }

    public DateTime? StartTime { get; set; }

    public DateTime? FinishTime { get; set; }

    public int? MaxDeployCount { get; set; }

    public int? NextId { get; set; }

    public virtual Contest Contest { get; set; } = null!;

    public virtual Challenge ChallengeTemplate { get; set; } = null!;

    public virtual ChallengeVersion? TemplateVersion { get; set; }

    public virtual ContestChallenge? Next { get; set; }

    public virtual ICollection<ContestChallenge> InverseNext { get; set; } = new List<ContestChallenge>();

    public virtual ICollection<Submission> Submissions { get; set; } = new List<Submission>();

    public virtual ICollection<Solf> Solves { get; set; } = new List<Solf>();

    public virtual ICollection<ChallengeStartTracking> ChallengeStartTrackings { get; set; } = new List<ChallengeStartTracking>();

    public virtual ICollection<Unlock> Unlocks { get; set; } = new List<Unlock>();
}

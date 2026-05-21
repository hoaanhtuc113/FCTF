using System;

namespace ResourceShared.Models;

public partial class DeployHistory
{
    public int Id { get; set; }

    public int? ChallengeTemplateId { get; set; }

    public string? LogContent { get; set; }

    public string DeployStatus { get; set; } = null!;

    public DateTime? DeployAt { get; set; }

    public virtual Challenge? ChallengeTemplate { get; set; }
}

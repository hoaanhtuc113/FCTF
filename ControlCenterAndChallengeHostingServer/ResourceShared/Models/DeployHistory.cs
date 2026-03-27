using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class DeployHistory
{
    public int Id { get; set; }

    public int ChallengeId { get; set; }

    public string? LogContent { get; set; }

    public string DeployStatus { get; set; } = null!;

    public DateTime? DeployAt { get; set; }

    public virtual Challenge Challenge { get; set; } = null!;
}

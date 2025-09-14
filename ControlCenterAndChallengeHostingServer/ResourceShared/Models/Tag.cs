using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Tag
{
    public int Id { get; set; }

    public int? ChallengeId { get; set; }

    public string? Value { get; set; }

    public virtual Challenge? Challenge { get; set; }
}

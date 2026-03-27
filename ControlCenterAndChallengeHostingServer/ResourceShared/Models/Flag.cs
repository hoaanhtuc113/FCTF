using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Flag
{
    public int Id { get; set; }

    public int? ChallengeId { get; set; }

    public string? Type { get; set; }

    public string? Content { get; set; }

    public string? Data { get; set; }

    public virtual Challenge? Challenge { get; set; }
}

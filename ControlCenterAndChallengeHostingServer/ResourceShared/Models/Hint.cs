using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Hint
{
    public int Id { get; set; }

    public string? Type { get; set; }

    public int? ChallengeId { get; set; }

    public string? Content { get; set; }

    public int? Cost { get; set; }

    public string? Requirements { get; set; }

    public virtual Challenge? Challenge { get; set; }
}

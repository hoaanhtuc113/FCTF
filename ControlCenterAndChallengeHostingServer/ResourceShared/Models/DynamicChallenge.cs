using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class DynamicChallenge
{
    public int Id { get; set; }

    public int? Initial { get; set; }

    public int? Minimum { get; set; }

    public int? Decay { get; set; }

    public string? Function { get; set; }

    public virtual Challenge IdNavigation { get; set; } = null!;
}

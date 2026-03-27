using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class File
{
    public int Id { get; set; }

    public string? Type { get; set; }

    public string? Location { get; set; }

    public int? ChallengeId { get; set; }

    public string? Sha1sum { get; set; }

    public virtual Challenge? Challenge { get; set; }
}

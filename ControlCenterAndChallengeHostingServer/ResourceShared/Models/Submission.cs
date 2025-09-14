using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Submission
{
    public int Id { get; set; }

    public int? ChallengeId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public string? Ip { get; set; }

    public string? Provided { get; set; }

    public string? Type { get; set; }

    public DateTime? Date { get; set; }

    public virtual Challenge? Challenge { get; set; }

    public virtual Solf? Solf { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

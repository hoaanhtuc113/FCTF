using System;

namespace ResourceShared.Models;

public partial class Unlock
{
    public int Id { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public int? HintId { get; set; }

    public int? ChallengeId { get; set; }

    public DateTime? Date { get; set; }

    public string? Type { get; set; }

    public virtual Hint? Hint { get; set; }

    public virtual Challenge? Challenge { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

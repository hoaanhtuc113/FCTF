using System;

namespace ResourceShared.Models;

public partial class DynamicFlagInstance
{
    public int Id { get; set; }

    public int FlagId { get; set; }

    public int ChallengeId { get; set; }

    public int? TeamId { get; set; }

    public int? UserId { get; set; }

    public string Value { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public virtual Flag Flag { get; set; } = null!;

    public virtual Challenge Challenge { get; set; } = null!;

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

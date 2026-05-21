using System;

namespace ResourceShared.Models;

public partial class ChallengeStartTracking
{
    public int Id { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public int ChallengeId { get; set; }

    public DateTime StartedAt { get; set; }

    public DateTime? StoppedAt { get; set; }

    public string? Label { get; set; }

    public virtual Challenge Challenge { get; set; } = null!;

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

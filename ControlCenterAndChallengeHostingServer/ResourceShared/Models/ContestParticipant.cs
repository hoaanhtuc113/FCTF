using System;

namespace ResourceShared.Models;

/// <summary>
/// Ai tham gia contest nào, với role gì và score bao nhiêu.
/// Table: contest_participants
/// </summary>
public partial class ContestParticipant
{
    public int Id { get; set; }

    public int ContestId { get; set; }

    public int UserId { get; set; }

    public int? TeamId { get; set; }

    /// <summary>contestant | jury | challenge_writer</summary>
    public string Role { get; set; } = "contestant";

    public int Score { get; set; } = 0;

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastSolveAt { get; set; }

    // Navigation properties
    public virtual Contest Contest { get; set; } = null!;

    public virtual User User { get; set; } = null!;

    public virtual Team? Team { get; set; }
}

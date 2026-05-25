using System;

namespace ResourceShared.Models;

public partial class ContestParticipant
{
    public int Id { get; set; }

    public int ContestId { get; set; }

    public int UserId { get; set; }

    /// <summary>
    /// Contest-level role: "contestant" | "jury" | "challenge_writer"
    /// Platform-level roles (admin/user) are stored in users.type instead.
    /// </summary>
    public string Role { get; set; } = "contestant";

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    public virtual Contest Contest { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}

using System;

namespace ResourceShared.Models;

/// <summary>
/// Many-to-many: một user có thể thuộc nhiều team (ở các contest khác nhau).
/// Table: users_teams
/// </summary>
public class UserTeam
{
    public int UserId { get; set; }

    public int TeamId { get; set; }

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public virtual User User { get; set; } = null!;

    public virtual Team Team { get; set; } = null!;
}

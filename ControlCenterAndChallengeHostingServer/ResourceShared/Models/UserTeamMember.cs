using System;

namespace ResourceShared.Models;

public partial class UserTeamMember
{
    public int Id { get; set; }

    public int UserId { get; set; }

    public int TeamId { get; set; }

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    public virtual User User { get; set; } = null!;

    public virtual Team Team { get; set; } = null!;
}

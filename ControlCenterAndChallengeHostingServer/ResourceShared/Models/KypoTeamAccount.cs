using System;

namespace ResourceShared.Models;

public partial class KypoTeamAccount
{
    public int Id { get; set; }
    public int TeamId { get; set; }
    public string KypoUserId { get; set; } = null!;
    public string KypoUsername { get; set; } = null!;
    public string KypoPassword { get; set; } = null!;
    public DateTime CreatedAt { get; set; }

    public virtual Team Team { get; set; } = null!;
}

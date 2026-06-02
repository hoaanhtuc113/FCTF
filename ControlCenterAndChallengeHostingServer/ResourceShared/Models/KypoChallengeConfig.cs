using System;

namespace ResourceShared.Models;

public partial class KypoChallengeConfig
{
    public int Id { get; set; }
    public int ChallengeId { get; set; }
    public int KypoInstanceId { get; set; }
    public string KypoAccessToken { get; set; } = null!;
    public string KypoInstanceType { get; set; } = "linear";
    public string? KypoBaseUrl { get; set; }
    public DateTime CreatedAt { get; set; }

    public virtual Challenge Challenge { get; set; } = null!;
}

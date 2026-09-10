namespace ResourceShared.Models;

// Durable identity for one accepted challenge deployment. This record is not
// deleted with its Kubernetes namespace: it is the authoritative join key for
// request telemetry and its lifecycle history.
public partial class ChallengeInstance
{
    public string InstanceId { get; set; } = string.Empty;
    public string ProvisionRequestId { get; set; } = string.Empty;
    public int ContestId { get; set; }
    public int ChallengeId { get; set; }
    public string ContestNameSnapshot { get; set; } = string.Empty;
    public string ChallengeNameSnapshot { get; set; } = string.Empty;
    public string Namespace { get; set; } = string.Empty;
    public string InstanceScope { get; set; } = "team";
    public int? InstanceOwnerTeamId { get; set; }
    public string? OwnerTeamNameSnapshot { get; set; }
    public int? StartedByUserId { get; set; }
    public DateTime RequestedAt { get; set; }
    public DateTime? RunningAt { get; set; }
    public DateTime? StoppedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public string LifecycleState { get; set; } = "provisioning";
    public string? TerminalReason { get; set; }
    public string IdentitySource { get; set; } = "native";
    public long StateVersion { get; set; }
    public DateTime StateChangedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public virtual ICollection<ChallengeInstancePod> Pods { get; set; } = new List<ChallengeInstancePod>();
}

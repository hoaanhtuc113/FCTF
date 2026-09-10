namespace ResourceShared.Models;

// A pod UID is a physical-runtime observation, not an identity substitute for
// the deployment. Multiple pod UIDs may belong to one logical instance.
public partial class ChallengeInstancePod
{
    public string InstanceId { get; set; } = string.Empty;
    public string PodUid { get; set; } = string.Empty;
    public string PodName { get; set; } = string.Empty;
    public DateTime FirstObservedAt { get; set; }
    public DateTime LastObservedAt { get; set; }
    public DateTime? TerminatedAt { get; set; }
    public string? TerminationReason { get; set; }

    public virtual ChallengeInstance Instance { get; set; } = null!;
}

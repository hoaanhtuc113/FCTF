using System;

namespace ResourceShared.DTOs.Deployments;

public class PodLogsDTO
{
    public string PodName { get; set; } = string.Empty;
    public string Namespace { get; set; } = string.Empty;
    public int TeamId { get; set; }
    public int ChallengeId { get; set; }
    public string Logs { get; set; } = string.Empty;
    public string SourceState { get; set; } = "AVAILABLE";
    public string PodState { get; set; } = "UNKNOWN";
    public string LogState { get; set; } = "NOT_REQUESTED";
    public string PodPhase { get; set; } = "Unknown";
    public bool? Ready { get; set; }
    public string? Reason { get; set; }
    public string? LogReason { get; set; }
    public int TailLines { get; set; } = 1000;
    public int LimitBytes { get; set; } = 256 * 1024;
    public DateTimeOffset CheckedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Result of one bounded Kubernetes stdout/stderr read. A failed read is kept
/// distinct from a successful but empty log so callers never infer state from
/// an error string embedded in the log content.
/// </summary>
public class PodLogReadResultDTO
{
    public bool Success { get; set; }
    public string Logs { get; set; } = string.Empty;
    public string? SafeReason { get; set; }
}

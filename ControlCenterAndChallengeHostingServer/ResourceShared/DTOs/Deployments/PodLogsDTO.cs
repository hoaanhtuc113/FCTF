using System;

namespace ResourceShared.DTOs.Deployments;

public class PodLogsDTO
{
    public string PodName { get; set; } = string.Empty;
    public int TeamId { get; set; }
    public int ChallengeId { get; set; }
    public string Logs { get; set; } = string.Empty;
}

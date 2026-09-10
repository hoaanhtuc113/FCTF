using System.Text.Json.Serialization;

namespace ResourceShared.DTOs.Deployments;

public sealed class InstanceRequestLogsReqDTO
{
    public string InstanceId { get; set; } = string.Empty;
    public string? Cursor { get; set; }
    public InstanceRequestLogFiltersDTO? Filters { get; set; }
    public int Limit { get; set; } = 50;
}

public sealed class InstanceRequestLogFiltersDTO
{
    public DateTimeOffset? From { get; set; }
    public DateTimeOffset? To { get; set; }
    public List<string>? Protocol { get; set; }
    public List<string>? Events { get; set; }
    public string? ActorUserRef { get; set; }
    public List<int>? Status { get; set; }
    public List<string>? Outcome { get; set; }
}

public sealed class InstanceRequestLogsDTO
{
    public InstanceSummaryDTO Instance { get; set; } = new();
    public List<InstancePodHistoryDTO> PodHistory { get; set; } = new();
    public List<GatewayAccessEventDTO> Events { get; set; } = new();
    public string? NextCursor { get; set; }
    public string SourceStatus { get; set; } = "healthy";
}

public sealed class InstanceSummaryDTO
{
    public string InstanceId { get; set; } = string.Empty;
    public int ContestId { get; set; }
    public int ChallengeId { get; set; }
    public string ContestName { get; set; } = string.Empty;
    public string ChallengeName { get; set; } = string.Empty;
    public string Namespace { get; set; } = string.Empty;
    public string Scope { get; set; } = string.Empty;
    public int? OwnerTeamId { get; set; }
    public string? OwnerTeamName { get; set; }
    public string LifecycleState { get; set; } = string.Empty;
    public string IdentitySource { get; set; } = string.Empty;
    public DateTime RequestedAt { get; set; }
    public DateTime? RunningAt { get; set; }
    public DateTime? StoppedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
}

public sealed class InstancePodHistoryDTO
{
    public string PodUid { get; set; } = string.Empty;
    public string PodName { get; set; } = string.Empty;
    public DateTime FirstObservedAt { get; set; }
    public DateTime LastObservedAt { get; set; }
    public DateTime? TerminatedAt { get; set; }
    public string? TerminationReason { get; set; }
}

// Mirrors the Gateway JSON schema. Unknown optional fields remain omitted by
// the sender and are never reconstructed from namespace or pod names.
public sealed class GatewayAccessEventDTO
{
    [JsonPropertyName("schema_version")]
    public int SchemaVersion { get; set; }
    [JsonPropertyName("event_id")]
    public string EventId { get; set; } = string.Empty;
    [JsonPropertyName("occurred_at")]
    public DateTimeOffset OccurredAt { get; set; }
    [JsonPropertyName("event")]
    public string Event { get; set; } = string.Empty;
    [JsonPropertyName("protocol")]
    public string Protocol { get; set; } = string.Empty;
    [JsonPropertyName("instance_id")]
    public string InstanceId { get; set; } = string.Empty;
    [JsonPropertyName("instance_namespace")]
    public string? InstanceNamespace { get; set; }
    [JsonPropertyName("contest_id")]
    public int? ContestId { get; set; }
    [JsonPropertyName("challenge_id")]
    public int? ChallengeId { get; set; }
    [JsonPropertyName("actor_user_ref")]
    public string? ActorUserRef { get; set; }
    [JsonPropertyName("actor_team_id")]
    public int? ActorTeamId { get; set; }
    [JsonPropertyName("peer_ip")]
    public string? PeerIp { get; set; }
    [JsonPropertyName("ip_source")]
    public string? IpSource { get; set; }
    [JsonPropertyName("method")]
    public string? Method { get; set; }
    [JsonPropertyName("path")]
    public string? Path { get; set; }
    [JsonPropertyName("status")]
    public int? Status { get; set; }
    [JsonPropertyName("request_bytes")]
    public long? RequestBytes { get; set; }
    [JsonPropertyName("response_bytes")]
    public long? ResponseBytes { get; set; }
    [JsonPropertyName("bytes_c2s")]
    public long? BytesC2S { get; set; }
    [JsonPropertyName("bytes_s2c")]
    public long? BytesS2C { get; set; }
    [JsonPropertyName("duration_ms")]
    public long? DurationMs { get; set; }
    [JsonPropertyName("outcome")]
    public string? Outcome { get; set; }
    [JsonPropertyName("termination_reason")]
    public string? TerminationReason { get; set; }
    [JsonPropertyName("auth_strength")]
    public string? AuthStrength { get; set; }
    [JsonPropertyName("data_class")]
    public string DataClass { get; set; } = "metadata";
}

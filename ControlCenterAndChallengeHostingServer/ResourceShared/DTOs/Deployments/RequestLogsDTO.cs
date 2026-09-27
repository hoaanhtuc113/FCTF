using System.Text.Json;

namespace ResourceShared.DTOs.Deployments;

public class RequestLogsDTO
{
    public int TeamId { get; set; }
    public int ChallengeId { get; set; }
    public string InstanceNamespace { get; set; } = string.Empty;
    public int WindowHours { get; set; } = 6;
    public int Limit { get; set; } = 2000;
    public bool LimitReached { get; set; }
    public string QueryStatus { get; set; } = "ok";
    public Dictionary<string, string> SourceStatus { get; set; } = new();
    public List<RequestLogEventDTO> Events { get; set; } = [];
}

public class RequestLogEventDTO
{
    public string RowId { get; set; } = string.Empty;
    public string? EventId { get; set; }
    public string? SessionId { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public string Protocol { get; set; } = "unknown";
    public string Event { get; set; } = "other";
    public string SourceFormat { get; set; } = string.Empty;
    public string? Method { get; set; }
    public string? Path { get; set; }
    public int? Status { get; set; }
    public string? Outcome { get; set; }
    public string? ErrorCode { get; set; }
    public string? TerminationReason { get; set; }
    public string? AuthStrength { get; set; }
    public long? RequestBytes { get; set; }
    public long? ResponseBytes { get; set; }
    public long? BytesC2S { get; set; }
    public long? BytesS2C { get; set; }
    public long? DurationMs { get; set; }
    public string ContentStatus { get; set; } = "—";
}

public class RequestLogDetailDTO
{
    public string RowId { get; set; } = string.Empty;
    public string? EventId { get; set; }
    public string? SessionId { get; set; }
    public string SourceFormat { get; set; } = string.Empty;
    public string ContentStatus { get; set; } = "—";
    public string? LegacyContent { get; set; }
    public JsonElement? Request { get; set; }
    public JsonElement? Response { get; set; }
    public string? Message { get; set; }
}

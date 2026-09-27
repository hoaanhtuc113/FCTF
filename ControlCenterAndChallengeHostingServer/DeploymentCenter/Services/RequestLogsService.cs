using System.IO.Compression;
using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ResourceShared;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Models;
using DeploymentCenter.Utils;

namespace DeploymentCenter.Services;

public sealed class RequestLogsService
{
    private const int ResultLimit = 2000;
    private const int LokiReadLimit = ResultLimit + 1;
    private static readonly Regex NamespacePattern = new("^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly HashSet<string> KnownEvents = new(StringComparer.Ordinal)
    {
        "http_request", "http_auth_failed", "http_rate_limited", "http_upstream_error",
        "tcp_connect", "tcp_auth_failed", "tcp_rate_limited", "tcp_dial_failed", "tcp_session_end"
    };

    private readonly AppDbContext _dbContext;

    public RequestLogsService(AppDbContext dbContext) => _dbContext = dbContext;

    public async Task<BaseResponseDTO<RequestLogsDTO>> ListAsync(ChallengeStartStopReqDTO req)
    {
        if (!ValidScope(req))
            return Failure<RequestLogsDTO>(HttpStatusCode.BadRequest, "Invalid challenge, team, or namespace.");
        if (!await HasTrackingAsync(req))
            return Failure<RequestLogsDTO>(HttpStatusCode.NotFound, "No verified deployment matches this scope.");

        var now = DateTimeOffset.UtcNow;
        var start = now.AddHours(-6);
        var selector = NormalizeSelector(DeploymentCenterConfigHelper.LOKI_QUERY_SELECTOR);
        var namespaceValue = req.ns!;
        var legacyQuery = $"{selector} | logfmt | ns=\"{namespaceValue}\"";
        var jsonQuery = $"{selector} | json | instance_namespace=\"{namespaceValue}\"";

        var legacyResult = await QueryLokiAsync(legacyQuery, start, now);
        var jsonResult = await QueryLokiAsync(jsonQuery, start, now);
        if (legacyResult.Error && jsonResult.Error)
            return Failure<RequestLogsDTO>(HttpStatusCode.BadGateway, "Loki is unavailable; request logs could not be loaded.");

        var legacyRows = legacyResult.Rows
            .Select(row => ParseLegacy(row, req))
            .Where(row => row is not null)
            .Cast<RequestLogEventDTO>()
            .ToList();
        var jsonRows = jsonResult.Rows
            .Select(row => ParseJSON(row, req))
            .Where(row => row is not null)
            .Cast<RequestLogEventDTO>()
            .ToList();
        var merged = legacyRows.Concat(jsonRows)
            .OrderByDescending(row => row.Timestamp)
            .ThenByDescending(row => row.RowId, StringComparer.Ordinal)
            .ToList();
        var limitReached = merged.Count > ResultLimit
            || legacyResult.Rows.Count >= LokiReadLimit
            || jsonResult.Rows.Count >= LokiReadLimit;

        var result = new RequestLogsDTO
        {
            TeamId = req.teamId,
            ChallengeId = req.challengeId,
            InstanceNamespace = req.ns!,
            WindowHours = 6,
            Limit = ResultLimit,
            LimitReached = limitReached,
            QueryStatus = legacyResult.Error || jsonResult.Error ? "partial" : "ok",
            SourceStatus = new Dictionary<string, string>
            {
                ["Legacy"] = legacyResult.Error ? "error" : "ok",
                ["JSON v1"] = jsonResult.Error ? "error" : "ok"
            },
            Events = merged.Take(ResultLimit).ToList()
        };
        return new BaseResponseDTO<RequestLogsDTO>
        {
            Success = true,
            HttpStatusCode = HttpStatusCode.OK,
            Data = result,
            Message = legacyResult.Error || jsonResult.Error ? "Partial result; one Loki query failed." : "Success"
        };
    }

    public async Task<BaseResponseDTO<RequestLogDetailDTO>> DetailAsync(ChallengeStartStopReqDTO req)
    {
        if (!ValidScope(req) || (string.IsNullOrWhiteSpace(req.eventId) == string.IsNullOrWhiteSpace(req.rowId)))
            return Failure<RequestLogDetailDTO>(HttpStatusCode.BadRequest, "Provide one valid eventId or rowId and a verified scope.");
        if (!await HasTrackingAsync(req))
            return Failure<RequestLogDetailDTO>(HttpStatusCode.NotFound, "No verified deployment matches this scope.");
        if (!string.IsNullOrWhiteSpace(req.eventId) && !Guid.TryParse(req.eventId, out _))
            return Failure<RequestLogDetailDTO>(HttpStatusCode.BadRequest, "Invalid eventId.");

        var now = DateTimeOffset.UtcNow;
        var start = now.AddHours(-6);
        var selector = NormalizeSelector(DeploymentCenterConfigHelper.LOKI_QUERY_SELECTOR);
        if (string.IsNullOrWhiteSpace(req.eventId))
        {
            var legacyResult = await QueryLokiAsync($"{selector} | logfmt | ns=\"{req.ns}\"", start, now);
            if (legacyResult.Error)
                return Failure<RequestLogDetailDTO>(HttpStatusCode.BadGateway, "Loki is unavailable; legacy request log detail could not be loaded.");
            var legacyMatch = legacyResult.Rows.FirstOrDefault(row =>
                string.Equals(StableRowID(row), req.rowId, StringComparison.Ordinal));
            if (legacyMatch is null || ParseLegacy(legacyMatch, req) is null)
                return Failure<RequestLogDetailDTO>(HttpStatusCode.NotFound, "Legacy request log row was not found in the six hour window.");

            var sanitizedLine = RedactLegacyLine(legacyMatch.LogLine);
            if (sanitizedLine.Length > 64 * 1024)
                sanitizedLine = sanitizedLine[..(64 * 1024)] + " [truncated]";
            var hasContent = sanitizedLine.Contains("body=", StringComparison.OrdinalIgnoreCase)
                || sanitizedLine.Contains("sample_b64=", StringComparison.OrdinalIgnoreCase);
            return new BaseResponseDTO<RequestLogDetailDTO>
            {
                Success = true,
                HttpStatusCode = HttpStatusCode.OK,
                Data = new RequestLogDetailDTO
                {
                    RowId = req.rowId!,
                    SourceFormat = "Legacy",
                    ContentStatus = hasContent ? "available" : "metadata_only",
                    LegacyContent = sanitizedLine,
                    Message = hasContent ? "Legacy content shown only when it was present in the original line; it may be truncated." : "No request body or TCP sample was recorded in this legacy row."
                }
            };
        }

        var query = $"{selector} | json | instance_namespace=\"{req.ns}\" | event_id=\"{EscapeLogQL(req.eventId!)}\"";
        var jsonResult = await QueryLokiAsync(query, start, now);
        if (jsonResult.Error)
            return Failure<RequestLogDetailDTO>(HttpStatusCode.BadGateway, "Loki is unavailable; request log detail could not be loaded.");
        var match = jsonResult.Rows.Select(row => ParseJSONRow(row, req)).FirstOrDefault(row => row is not null);
        if (match is null)
            return Failure<RequestLogDetailDTO>(HttpStatusCode.NotFound, "Request log event was not found in the six hour window.");
        return await JSONDetailAsync(match, req);
    }

    private async Task<BaseResponseDTO<RequestLogDetailDTO>> JSONDetailAsync(LokiRow row, ChallengeStartStopReqDTO req)
    {
        using var metadata = JsonDocument.Parse(row.LogLine);
        var root = metadata.RootElement;
        var eventId = String(root, "event_id");
        var eventName = String(root, "event");
        if (String(root, "protocol") != "http")
        {
            return new BaseResponseDTO<RequestLogDetailDTO>
            {
                Success = true,
                HttpStatusCode = HttpStatusCode.OK,
                Data = new RequestLogDetailDTO
                {
                    RowId = eventId,
                    EventId = eventId,
                    SessionId = String(root, "session_id"),
                    SourceFormat = "JSON v1",
                    ContentStatus = "metadata_only",
                    Message = eventName.StartsWith("tcp_", StringComparison.Ordinal) ? "TCP payload is not captured." : "This event has metadata only."
                }
            };
        }

        var submission = String(root, "capture_submission");
        if (submission is "not_requested" or "skipped_by_policy" or "dropped" or "")
        {
            var status = submission switch
            {
                "not_requested" => "not_requested",
                "skipped_by_policy" => "skipped_by_policy",
                "dropped" => "dropped",
                _ => "metadata_only"
            };
            return new BaseResponseDTO<RequestLogDetailDTO>
            {
                Success = true,
                HttpStatusCode = HttpStatusCode.OK,
                Data = new RequestLogDetailDTO { RowId = eventId, EventId = eventId, SourceFormat = "JSON v1", ContentStatus = status, Message = "No HTTP content object is expected for this event." }
            };
        }

        if (!DateTimeOffset.TryParse(String(root, "occurred_at"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var occurredAt))
            return Failure<RequestLogDetailDTO>(HttpStatusCode.BadGateway, "The Loki event has an invalid timestamp.");
        var objectKey = $"request-logs/{occurredAt.UtcDateTime:yyyy/MM/dd}/{req.ns}/{eventId}/transaction.json.gz";
        var store = RequestLogObjectReader.FromEnvironment();
        if (store is null)
        {
            return new BaseResponseDTO<RequestLogDetailDTO>
            {
                Success = true,
                HttpStatusCode = HttpStatusCode.OK,
                Data = new RequestLogDetailDTO { RowId = eventId, EventId = eventId, SourceFormat = "JSON v1", ContentStatus = "unavailable", Message = "HTTP content storage is not configured for the reader." }
            };
        }

        (int StatusCode, byte[]? Content) read;
        try
        {
            read = await store.GetAsync(objectKey);
        }
        catch
        {
            return new BaseResponseDTO<RequestLogDetailDTO> { Success = true, HttpStatusCode = HttpStatusCode.OK, Data = new RequestLogDetailDTO { RowId = eventId, EventId = eventId, SourceFormat = "JSON v1", ContentStatus = "unavailable", Message = "The content object store is unavailable." } };
        }
        if (read.StatusCode == 404)
        {
            var pending = DateTimeOffset.UtcNow - occurredAt.ToUniversalTime() < TimeSpan.FromMinutes(2);
            return new BaseResponseDTO<RequestLogDetailDTO>
            {
                Success = true,
                HttpStatusCode = HttpStatusCode.OK,
                Data = new RequestLogDetailDTO { RowId = eventId, EventId = eventId, SourceFormat = "JSON v1", ContentStatus = pending ? "pending" : "missing", Message = pending ? "The bounded capture may still be uploading; refresh this detail shortly." : "The event exists in Loki, but its content object is unavailable." }
            };
        }
        if (read.StatusCode == 410)
            return new BaseResponseDTO<RequestLogDetailDTO> { Success = true, HttpStatusCode = HttpStatusCode.OK, Data = new RequestLogDetailDTO { RowId = eventId, EventId = eventId, SourceFormat = "JSON v1", ContentStatus = "expired", Message = "The object store reports that this content has expired." } };
        if (read.StatusCode != 200 || read.Content is null)
            return new BaseResponseDTO<RequestLogDetailDTO> { Success = true, HttpStatusCode = HttpStatusCode.OK, Data = new RequestLogDetailDTO { RowId = eventId, EventId = eventId, SourceFormat = "JSON v1", ContentStatus = "unavailable", Message = "The content object store is unavailable." } };

        try
        {
            using var compressed = new MemoryStream(read.Content, writable: false);
            using var gzip = new GZipStream(compressed, CompressionMode.Decompress);
            using var expanded = new MemoryStream();
            var buffer = new byte[16 * 1024];
            while (true)
            {
                var count = await gzip.ReadAsync(buffer);
                if (count == 0) break;
                if (expanded.Length + count > 8 * 1024 * 1024)
                    throw new InvalidDataException("Content object exceeds the reader limit.");
                expanded.Write(buffer, 0, count);
            }
            using var transaction = JsonDocument.Parse(expanded.ToArray());
            var tx = transaction.RootElement;
            if (!ValidateTransaction(tx, root, req.ns!, eventId))
                return new BaseResponseDTO<RequestLogDetailDTO> { Success = true, HttpStatusCode = HttpStatusCode.OK, Data = new RequestLogDetailDTO { RowId = eventId, EventId = eventId, SourceFormat = "JSON v1", ContentStatus = "unavailable", Message = "The content object did not match the verified Loki event." } };

            var request = tx.TryGetProperty("request", out var requestPart) ? requestPart.Clone() : (JsonElement?)null;
            var response = tx.TryGetProperty("response", out var responsePart) ? responsePart.Clone() : (JsonElement?)null;
            return new BaseResponseDTO<RequestLogDetailDTO>
            {
                Success = true,
                HttpStatusCode = HttpStatusCode.OK,
                Data = new RequestLogDetailDTO
                {
                    RowId = eventId,
                    EventId = eventId,
                    SourceFormat = "JSON v1",
                    ContentStatus = "available",
                    Request = request,
                    Response = response,
                    Message = "Captured body and headers are bounded; fields marked truncated are incomplete."
                }
            };
        }
        catch
        {
            return new BaseResponseDTO<RequestLogDetailDTO> { Success = true, HttpStatusCode = HttpStatusCode.OK, Data = new RequestLogDetailDTO { RowId = eventId, EventId = eventId, SourceFormat = "JSON v1", ContentStatus = "unavailable", Message = "The content object could not be safely validated." } };
        }
    }

    private async Task<(List<LokiRow> Rows, bool Error)> QueryLokiAsync(string logql, DateTimeOffset start, DateTimeOffset end)
    {
        try
        {
            var lokiBaseUrl = (DeploymentCenterConfigHelper.LOKI_BASE_URL ?? "http://loki-stack:3100").TrimEnd('/');
            using var client = new HttpClient { BaseAddress = new Uri(lokiBaseUrl), Timeout = TimeSpan.FromSeconds(15) };
            var query = Uri.EscapeDataString(logql);
            var url = $"/loki/api/v1/query_range?query={query}&start={start.ToUnixTimeMilliseconds() * 1_000_000}&end={end.ToUnixTimeMilliseconds() * 1_000_000}&limit={LokiReadLimit}&direction=backward";
            using var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode)
                return ([], true);
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (!document.RootElement.TryGetProperty("data", out var data)
                || !data.TryGetProperty("result", out var results)
                || results.ValueKind != JsonValueKind.Array)
                return ([], true);

            var rows = new List<LokiRow>();
            foreach (var stream in results.EnumerateArray())
            {
                var streamText = stream.TryGetProperty("stream", out var labels) ? CanonicalLabels(labels) : string.Empty;
                if (!stream.TryGetProperty("values", out var values) || values.ValueKind != JsonValueKind.Array)
                    continue;
                foreach (var pair in values.EnumerateArray())
                {
                    if (pair.ValueKind != JsonValueKind.Array || pair.GetArrayLength() < 2
                        || !long.TryParse(pair[0].GetString(), out var tsNs))
                        continue;
                    var timestamp = DateTimeOffset.FromUnixTimeMilliseconds(tsNs / 1_000_000);
                    if (timestamp < start || timestamp > end)
                        continue;
                    rows.Add(new LokiRow(tsNs, timestamp, streamText, pair[1].GetString() ?? string.Empty));
                }
            }
            return (rows, false);
        }
        catch
        {
            return ([], true);
        }
    }

    private static RequestLogEventDTO? ParseJSON(LokiRow row, ChallengeStartStopReqDTO req)
    {
        var parsed = ParseJSONRow(row, req);
        return parsed?.Event;
    }

    private static LokiRow? ParseJSONRow(LokiRow row, ChallengeStartStopReqDTO req)
    {
        try
        {
            using var document = JsonDocument.Parse(row.LogLine);
            var root = document.RootElement;
            if (Int(root, "schema_version") != 1 || String(root, "instance_namespace") != req.ns)
                return null;
            var challengeId = Int(root, "challenge_id");
            var teamId = Int(root, "actor_team_id");
            if (challengeId.HasValue && challengeId.Value != req.challengeId)
                return null;
            if (teamId.HasValue && teamId.Value != req.teamId)
                return null;
            var eventId = String(root, "event_id");
            if (!string.IsNullOrWhiteSpace(req.eventId) && eventId != req.eventId)
                return null;
            if (string.IsNullOrWhiteSpace(eventId) || !Guid.TryParse(eventId, out _))
                return null;
            var eventName = String(root, "event");
            var protocol = String(root, "protocol");
            var occurred = DateTimeOffset.TryParse(String(root, "occurred_at"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var eventTime) ? eventTime : row.Timestamp;
            var submission = String(root, "capture_submission");
            var status = submission switch
            {
                "queued" => "pending",
                "skipped_by_policy" => "skipped_by_policy",
                "dropped" => "dropped",
                "not_requested" => "not_requested",
                _ => "metadata_only"
            };
            var dto = new RequestLogEventDTO
            {
                RowId = eventId,
                EventId = eventId,
                SessionId = String(root, "session_id"),
                Timestamp = occurred,
                Protocol = protocol is "http" or "tcp" ? protocol : "unknown",
                Event = KnownEvents.Contains(eventName) ? eventName : "other",
                SourceFormat = "JSON v1",
                Method = String(root, "method"),
                Path = String(root, "path"),
                Status = Int(root, "status"),
                Outcome = String(root, "outcome"),
                ErrorCode = String(root, "error_code"),
                TerminationReason = String(root, "termination_reason"),
                AuthStrength = String(root, "auth_strength"),
                RequestBytes = Long(root, "request_bytes"),
                ResponseBytes = Long(root, "response_bytes"),
                BytesC2S = Long(root, "bytes_c2s"),
                BytesS2C = Long(root, "bytes_s2c"),
                DurationMs = Long(root, "duration_ms"),
                ContentStatus = status
            };
            return new LokiRow(row.TimestampNs, row.Timestamp, row.Stream, row.LogLine, dto);
        }
        catch
        {
            return null;
        }
    }

    private static RequestLogEventDTO? ParseLegacy(LokiRow row, ChallengeStartStopReqDTO req)
    {
        if (!row.LogLine.Contains($"ns=\"{req.ns}\"", StringComparison.Ordinal))
            return null;
        var http = Regex.Match(row.LogLine, "^HTTP (?<method>[A-Z]+) (?<path>\\S+) (?<status>\\d{3})\\b", RegexOptions.CultureInvariant);
        var tcp = Regex.IsMatch(row.LogLine, "^\\[~\\] TCP proxy (?<direction>c2s|s2c)\\b", RegexOptions.CultureInvariant);
        if (!http.Success && !tcp)
            return null;

        var team = Regex.Match(row.LogLine, "team=\\\"(?<id>\\d+)\\\"", RegexOptions.CultureInvariant);
        var challenge = Regex.Match(row.LogLine, "challenge=\\\"(?<id>\\d+)\\\"", RegexOptions.CultureInvariant);
        var statusMatch = http.Success ? http.Groups["status"] : Match.Empty;
        var bytesMatch = Regex.Match(row.LogLine, "\\bbytes=(?<bytes>\\d+)", RegexOptions.CultureInvariant);
        if (team.Success && int.TryParse(team.Groups["id"].Value, out var rowTeam) && rowTeam != req.teamId)
            return null;
        if (challenge.Success && int.TryParse(challenge.Groups["id"].Value, out var rowChallenge) && rowChallenge != req.challengeId)
            return null;

        return new RequestLogEventDTO
        {
            RowId = StableRowID(row),
            Timestamp = row.Timestamp,
            Protocol = http.Success ? "http" : "tcp",
            Event = http.Success ? "http_request" : "tcp_transfer",
            SourceFormat = "Legacy",
            Method = http.Success ? http.Groups["method"].Value : null,
            Path = http.Success ? SanitizeLegacyPath(http.Groups["path"].Value) : null,
            Status = int.TryParse(statusMatch.Value, out var status) ? status : null,
            BytesC2S = tcp && row.LogLine.Contains("direction=\"c2s\"", StringComparison.Ordinal) && long.TryParse(bytesMatch.Groups["bytes"].Value, out var c2s) ? c2s : null,
            BytesS2C = tcp && row.LogLine.Contains("direction=\"s2c\"", StringComparison.Ordinal) && long.TryParse(bytesMatch.Groups["bytes"].Value, out var s2c) ? s2c : null,
            ContentStatus = row.LogLine.Contains("body=", StringComparison.Ordinal) || row.LogLine.Contains("sample_b64=", StringComparison.Ordinal) ? "available" : "metadata_only"
        };
    }

    private async Task<bool> HasTrackingAsync(ChallengeStartStopReqDTO req)
    {
        return await _dbContext.ChallengeStartTrackings.AsNoTracking().AnyAsync(row =>
            row.ChallengeId == req.challengeId
            && row.TeamId == req.teamId
            && row.Label == req.ns);
    }

    private static bool ValidScope(ChallengeStartStopReqDTO req) =>
        req.challengeId > 0 && req.teamId > 0 && !string.IsNullOrWhiteSpace(req.ns)
        && NamespacePattern.IsMatch(req.ns);

    private static string NormalizeSelector(string? raw)
    {
        var selector = (raw ?? "{app=\"challenge-gateway\"}").Replace("\\\"", "\"").Trim();
        if (string.IsNullOrWhiteSpace(selector)) selector = "{app=\"challenge-gateway\"}";
        while (selector.StartsWith("{{", StringComparison.Ordinal) && selector.EndsWith("}}", StringComparison.Ordinal) && selector.Length >= 4)
            selector = selector[1..^1].Trim();
        if (!selector.StartsWith('{')) selector = "{" + selector;
        if (!selector.EndsWith('}')) selector += "}";
        return Regex.Replace(selector, @"(?<key>[a-zA-Z_][a-zA-Z0-9_]*)=(?<val>[a-zA-Z0-9._:-]+)", "${key}=\"${val}\"");
    }

    private static string EscapeLogQL(string value) => value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal);

    private static string StableRowID(LokiRow row)
    {
        var bytes = Encoding.UTF8.GetBytes($"{row.TimestampNs}\0{row.Stream}\0{row.LogLine}");
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    private static string CanonicalLabels(JsonElement labels)
    {
        if (labels.ValueKind != JsonValueKind.Object)
            return string.Empty;
        return string.Join("\n", labels.EnumerateObject()
            .OrderBy(property => property.Name, StringComparer.Ordinal)
            .Select(property => property.Name + "=" + property.Value.ToString()));
    }

    private static string RedactLegacyLine(string line)
    {
        var http = Regex.Match(line, "^HTTP [A-Z]+ (?<path>\\S+) \\d{3}\\b", RegexOptions.CultureInvariant);
        if (http.Success)
        {
            var path = http.Groups["path"];
            line = line[..path.Index] + SanitizeLegacyPath(path.Value) + line[(path.Index + path.Length)..];
        }

        var result = RedactLegacyFields(line);
        return Regex.Replace(result, @"\bsample_b64=(?<value>[A-Za-z0-9+/=]+)", match =>
        {
            try
            {
                var bytes = Convert.FromBase64String(match.Groups["value"].Value);
                if (bytes.Length > 32 * 1024)
                    return "sample_b64=[REDACTED]";
                var sample = new UTF8Encoding(false, true).GetString(bytes);
                var sanitized = RedactLegacyFields(sample);
                return "sample_b64=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(sanitized));
            }
            catch (FormatException)
            {
                return "sample_b64=[REDACTED]";
            }
            catch (DecoderFallbackException)
            {
                return "sample_b64=[REDACTED]";
            }
        }, RegexOptions.CultureInvariant);
    }

    private static string RedactLegacyFields(string line)
    {
        var result = Regex.Replace(line,
            @"(?i)(?<key>[A-Za-z0-9_.-]*(?:authorization|cookie|password|passwd|pwd|secret|token|api[_-]?key)[A-Za-z0-9_.-]*)=""(?<value>(?:[^""\\]|\\.)*)""",
            "${key}=\"[REDACTED]\"");
        result = Regex.Replace(result,
            @"(?i)(\\?""[A-Za-z0-9_.-]*(?:authorization|cookie|password|passwd|pwd|secret|token|api[_-]?key)[A-Za-z0-9_.-]*\\?""\s*:\s*\\?"")(?:\\.|[^""\\])*(\\?"")",
            "$1[REDACTED]$2");
        result = Regex.Replace(result,
            @"(?i)(?<key>[A-Za-z0-9_.-]*(?:authorization|cookie|password|passwd|pwd|secret|token|api[_-]?key)[A-Za-z0-9_.-]*)=([^&\s"" ]+)",
            "${key}=[REDACTED]");
        return result;
    }

    private static string SanitizeLegacyPath(string path)
    {
        var queryStart = path.IndexOf('?');
        if (queryStart < 0 || queryStart == path.Length - 1)
            return path;

        var parts = path[(queryStart + 1)..].Split('&');
        for (var i = 0; i < parts.Length; i++)
        {
            var equals = parts[i].IndexOf('=');
            if (equals < 0)
                continue;
            var rawName = parts[i][..equals];
            var decodedName = WebUtility.UrlDecode(rawName) ?? string.Empty;
            if (SensitiveLegacyField(decodedName))
                parts[i] = rawName + "=[REDACTED]";
        }
        return path[..(queryStart + 1)] + string.Join("&", parts);
    }

    private static bool SensitiveLegacyField(string name) =>
        name.Contains("authorization", StringComparison.OrdinalIgnoreCase)
        || name.Contains("cookie", StringComparison.OrdinalIgnoreCase)
        || name.Contains("password", StringComparison.OrdinalIgnoreCase)
        || name.Contains("passwd", StringComparison.OrdinalIgnoreCase)
        || name.Contains("pwd", StringComparison.OrdinalIgnoreCase)
        || name.Contains("secret", StringComparison.OrdinalIgnoreCase)
        || name.Contains("token", StringComparison.OrdinalIgnoreCase)
        || name.Contains("api_key", StringComparison.OrdinalIgnoreCase)
        || name.Contains("api-key", StringComparison.OrdinalIgnoreCase);

    private static bool ValidateTransaction(JsonElement tx, JsonElement metadata, string ns, string eventId)
    {
        if (Int(metadata, "content_schema_version") != 1
            || Int(tx, "content_schema_version") != 1
            || String(tx, "event_id") != eventId
            || String(tx, "instance_namespace") != ns
            || String(tx, "capture_profile") != "bounded_content"
            || !DateTimeOffset.TryParse(String(tx, "occurred_at"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var txTime)
            || !DateTimeOffset.TryParse(String(metadata, "occurred_at"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var eventTime)
            || Math.Abs((txTime - eventTime).TotalSeconds) > 1
            || String(tx, "method") != String(metadata, "method")
            || String(tx, "path") != String(metadata, "path")
            || Int(tx, "status") != Int(metadata, "status")
            || Int(tx, "challenge_id") != Int(metadata, "challenge_id")
            || Int(tx, "actor_team_id") != Int(metadata, "actor_team_id"))
            return false;
        return ValidPart(tx, "request") && ValidPart(tx, "response");
    }

    private static bool ValidPart(JsonElement tx, string name)
    {
        if (!tx.TryGetProperty(name, out var part)) return false;
        var encoded = String(part, "body_base64");
        byte[] bytes;
        try { bytes = string.IsNullOrEmpty(encoded) ? [] : Convert.FromBase64String(encoded); }
        catch { return false; }
        if (Int(part, "captured_size") != bytes.Length || bytes.Length > 2 * 1024 * 1024)
            return false;
        var hash = String(part, "captured_sha256");
        if (bytes.Length == 0) return string.IsNullOrEmpty(hash);
        var actual = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        return string.Equals(hash, actual, StringComparison.OrdinalIgnoreCase);
    }

    private static string String(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : string.Empty;

    private static int? Int(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.TryGetInt32(out var result)
            ? result : null;

    private static long? Long(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.TryGetInt64(out var result)
            ? result : null;

    private static BaseResponseDTO<T> Failure<T>(HttpStatusCode code, string message) => new()
    {
        Success = false,
        HttpStatusCode = code,
        Message = message
    };

    private sealed record LokiRow(long TimestampNs, DateTimeOffset Timestamp, string Stream, string LogLine, RequestLogEventDTO? Event = null);
}

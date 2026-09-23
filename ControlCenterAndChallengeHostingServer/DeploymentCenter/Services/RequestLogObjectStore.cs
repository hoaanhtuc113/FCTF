using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DeploymentCenter.Utils;
using ResourceShared.DTOs.Deployments;

namespace DeploymentCenter.Services;

public sealed record RequestLogObjectReadResult(string State, byte[]? Json);

public interface IRequestLogObjectStore
{
    Task<RequestLogObjectReadResult> ReadAsync(GatewayAccessEventDTO metadata, CancellationToken cancellationToken = default);
}

// Chooses a read-only S3 adapter in production. The filesystem reader remains
// only for local development; it derives the same deterministic key and never
// scans a shared directory for an attacker-supplied event id.
public sealed class RequestLogObjectStore : IRequestLogObjectStore
{
    private readonly IRequestLogObjectStore _inner;

    public RequestLogObjectStore()
    {
        var hasS3Configuration = !string.IsNullOrWhiteSpace(DeploymentCenterConfigHelper.REQUEST_LOG_S3_ENDPOINT)
            || !string.IsNullOrWhiteSpace(DeploymentCenterConfigHelper.REQUEST_LOG_S3_BUCKET)
            || !string.IsNullOrWhiteSpace(DeploymentCenterConfigHelper.REQUEST_LOG_S3_ACCESS_KEY);
        if (hasS3Configuration)
        {
            _inner = S3RequestLogObjectStore.TryCreate(out var store) ? store : new UnavailableRequestLogObjectStore();
            return;
        }

        var isProduction = string.Equals(Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"), "Production", StringComparison.OrdinalIgnoreCase);
        _inner = isProduction ? new UnavailableRequestLogObjectStore() : new LocalRequestLogObjectStore();
    }

    public Task<RequestLogObjectReadResult> ReadAsync(GatewayAccessEventDTO metadata, CancellationToken cancellationToken = default)
        => _inner.ReadAsync(metadata, cancellationToken);
}

internal sealed class UnavailableRequestLogObjectStore : IRequestLogObjectStore
{
    public Task<RequestLogObjectReadResult> ReadAsync(GatewayAccessEventDTO metadata, CancellationToken cancellationToken = default)
        => Task.FromResult(new RequestLogObjectReadResult("unavailable", null));
}

internal sealed class LocalRequestLogObjectStore : IRequestLogObjectStore
{
    private readonly string _root = DeploymentCenterConfigHelper.REQUEST_LOG_OBJECT_DIR.Trim();

    public async Task<RequestLogObjectReadResult> ReadAsync(GatewayAccessEventDTO metadata, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_root)) return new("unavailable", null);
        var key = RequestLogObjectKey.Derive(metadata);
        if (key is null) return new("missing", null);
        var path = Path.Combine(_root, key.Replace('/', Path.DirectorySeparatorChar));
        try
        {
            await using var file = File.OpenRead(path);
            return await RequestLogObjectReader.ReadGzipAsync(file, cancellationToken);
        }
        catch (FileNotFoundException) { return new("missing", null); }
        catch (DirectoryNotFoundException) { return new("missing", null); }
        catch (IOException) { return new("unavailable", null); }
        catch (UnauthorizedAccessException) { return new("unavailable", null); }
    }
}

internal sealed class S3RequestLogObjectStore : IRequestLogObjectStore
{
    private readonly Uri _endpoint;
    private readonly string _bucket;
    private readonly string _region;
    private readonly string _accessKey;
    private readonly string _secretKey;
    private readonly string _sessionToken;
    private readonly bool _pathStyle;
    private readonly HttpClient _client = new() { Timeout = TimeSpan.FromSeconds(15) };

    private S3RequestLogObjectStore(Uri endpoint, string bucket, string region, string accessKey, string secretKey, string sessionToken, bool pathStyle)
    {
        _endpoint = endpoint;
        _bucket = bucket;
        _region = region;
        _accessKey = accessKey;
        _secretKey = secretKey;
        _sessionToken = sessionToken;
        _pathStyle = pathStyle;
    }

    public static bool TryCreate(out S3RequestLogObjectStore store)
    {
        store = null!;
        var endpointText = DeploymentCenterConfigHelper.REQUEST_LOG_S3_ENDPOINT.Trim();
        if (!Uri.TryCreate(endpointText, UriKind.Absolute, out var endpoint)
            || !string.Equals(endpoint.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !RequestLogObjectKey.IsSafeBucket(DeploymentCenterConfigHelper.REQUEST_LOG_S3_BUCKET)
            || string.IsNullOrWhiteSpace(DeploymentCenterConfigHelper.REQUEST_LOG_S3_ACCESS_KEY)
            || string.IsNullOrWhiteSpace(DeploymentCenterConfigHelper.REQUEST_LOG_S3_SECRET_KEY))
            return false;
        store = new(endpoint, DeploymentCenterConfigHelper.REQUEST_LOG_S3_BUCKET,
            string.IsNullOrWhiteSpace(DeploymentCenterConfigHelper.REQUEST_LOG_S3_REGION) ? "us-east-1" : DeploymentCenterConfigHelper.REQUEST_LOG_S3_REGION,
            DeploymentCenterConfigHelper.REQUEST_LOG_S3_ACCESS_KEY, DeploymentCenterConfigHelper.REQUEST_LOG_S3_SECRET_KEY,
            DeploymentCenterConfigHelper.REQUEST_LOG_S3_SESSION_TOKEN, DeploymentCenterConfigHelper.REQUEST_LOG_S3_PATH_STYLE);
        return true;
    }

    public async Task<RequestLogObjectReadResult> ReadAsync(GatewayAccessEventDTO metadata, CancellationToken cancellationToken = default)
    {
        var key = RequestLogObjectKey.Derive(metadata);
        if (key is null) return new("missing", null);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, BuildObjectUri(key));
            request.Headers.TryAddWithoutValidation("x-amz-content-sha256", "UNSIGNED-PAYLOAD");
            Sign(request);
            using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return new("missing", null);
            if (!response.IsSuccessStatusCode) return new("unavailable", null);
            if (response.Content.Headers.ContentLength is > var compressedLength
                && compressedLength > DeploymentCenterConfigHelper.REQUEST_LOG_COMPRESSED_READ_MAX_BYTES)
                return new("unavailable", null);
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            return await RequestLogObjectReader.ReadGzipAsync(stream, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return new("unavailable", null); }
        catch (HttpRequestException) { return new("unavailable", null); }
        catch (IOException) { return new("unavailable", null); }
    }

    private Uri BuildObjectUri(string key)
    {
        var builder = new UriBuilder(_endpoint);
        var basePath = builder.Path.TrimEnd('/');
        var escapedKey = string.Join('/', key.Split('/').Select(Uri.EscapeDataString));
        if (_pathStyle)
            builder.Path = $"{basePath}/{Uri.EscapeDataString(_bucket)}/{escapedKey}";
        else
        {
            builder.Host = $"{_bucket}.{builder.Host}";
            builder.Path = $"{basePath}/{escapedKey}";
        }
        return builder.Uri;
    }

    private void Sign(HttpRequestMessage request)
    {
        var now = DateTimeOffset.UtcNow;
        var amzDate = now.ToString("yyyyMMddTHHmmssZ");
        var shortDate = now.ToString("yyyyMMdd");
        request.Headers.TryAddWithoutValidation("x-amz-date", amzDate);
        if (!string.IsNullOrWhiteSpace(_sessionToken)) request.Headers.TryAddWithoutValidation("x-amz-security-token", _sessionToken);

        var headers = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["host"] = request.RequestUri!.Authority
        };
        foreach (var header in request.Headers)
            headers[header.Key.ToLowerInvariant()] = string.Join(",", header.Value);
        var canonicalHeaders = string.Join("", headers.Select(pair => $"{pair.Key}:{NormalizeHeader(pair.Value)}\n"));
        var signedHeaders = string.Join(";", headers.Keys);
        var canonicalUri = request.RequestUri!.GetComponents(UriComponents.Path, UriFormat.UriEscaped);
        canonicalUri = "/" + canonicalUri;
        var payloadHash = request.Headers.GetValues("x-amz-content-sha256").Single();
        var canonicalRequest = string.Join("\n", request.Method.Method, canonicalUri, CanonicalQuery(request.RequestUri), canonicalHeaders, signedHeaders, payloadHash);
        var scope = $"{shortDate}/{_region}/s3/aws4_request";
        var stringToSign = $"AWS4-HMAC-SHA256\n{amzDate}\n{scope}\n{Sha256Hex(canonicalRequest)}";
        var signingKey = Hmac(Encoding.UTF8.GetBytes("AWS4" + _secretKey), shortDate);
        signingKey = Hmac(signingKey, _region);
        signingKey = Hmac(signingKey, "s3");
        signingKey = Hmac(signingKey, "aws4_request");
        var signature = Convert.ToHexString(Hmac(signingKey, stringToSign)).ToLowerInvariant();
        request.Headers.TryAddWithoutValidation("Authorization", $"AWS4-HMAC-SHA256 Credential={_accessKey}/{scope}, SignedHeaders={signedHeaders}, Signature={signature}");
    }

    private static string CanonicalQuery(Uri uri)
    {
        if (string.IsNullOrEmpty(uri.Query)) return string.Empty;
        return string.Join("&", uri.Query.TrimStart('?').Split('&').OrderBy(value => value, StringComparer.Ordinal));
    }

    private static string NormalizeHeader(string value) => string.Join(" ", value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    private static string Sha256Hex(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static byte[] Hmac(byte[] key, string value) => HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(value));
}

internal static class RequestLogObjectReader
{
    public static async Task<RequestLogObjectReadResult> ReadGzipAsync(Stream input, CancellationToken cancellationToken)
    {
        try
        {
            await using var cappedInput = new CappedReadStream(input, DeploymentCenterConfigHelper.REQUEST_LOG_COMPRESSED_READ_MAX_BYTES);
            await using var gzip = new GZipStream(cappedInput, CompressionMode.Decompress, leaveOpen: false);
            await using var output = new MemoryStream();
            var buffer = new byte[32 * 1024];
            while (true)
            {
                var read = await gzip.ReadAsync(buffer, cancellationToken);
                if (read == 0) break;
                if (output.Length + read > DeploymentCenterConfigHelper.REQUEST_LOG_READ_MAX_BYTES) return new("unavailable", null);
                await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
            return new("available", output.ToArray());
        }
        catch (InvalidDataException) { return new("unavailable", null); }
        catch (IOException) { return new("unavailable", null); }
    }
}

internal sealed class CappedReadStream(Stream inner, long maxBytes) : Stream
{
    private long _read;
    public override bool CanRead => inner.CanRead;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() => throw new NotSupportedException();
    public override int Read(byte[] buffer, int offset, int count) => Check(inner.Read(buffer, offset, count));
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => Check(await inner.ReadAsync(buffer, cancellationToken));
    private int Check(int read)
    {
        _read += read;
        if (_read > maxBytes) throw new InvalidDataException("compressed request-log object exceeds configured cap");
        return read;
    }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}

internal static class RequestLogObjectKey
{
    public static string? Derive(GatewayAccessEventDTO metadata)
    {
        if (!Guid.TryParse(metadata.InstanceId, out _) || !IsSafeSegment(metadata.EventId)) return null;
        var date = metadata.OccurredAt.UtcDateTime;
        return $"request-logs/{date:yyyy}/{date:MM}/{date:dd}/{metadata.InstanceId}/{metadata.EventId}/transaction.json.gz";
    }

    public static bool IsSafeSegment(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 128 && value.All(ch => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch is '-' or '_');

    public static bool IsSafeBucket(string? value) => !string.IsNullOrWhiteSpace(value)
        && value.Length is >= 3 and <= 63
        && !value.StartsWith('.') && !value.EndsWith('.') && !value.Contains("..", StringComparison.Ordinal)
        && value.All(ch => (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch is '-' or '.');
}

internal static class RequestLogTransactionValidator
{
    public static bool TryValidate(byte[] json, GatewayAccessEventDTO metadata, out JsonElement transaction)
    {
        transaction = default;
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("content_schema_version", out var schema) || schema.GetInt32() != 1
                || !Matches(root, "event_id", metadata.EventId) || !Matches(root, "instance_id", metadata.InstanceId)
                || !Matches(root, "capture_profile", "bounded_content")
                || !MatchesOptionalInteger(root, "status", metadata.Status)
                || !MatchesOptionalString(root, "method", metadata.Method)
                || !MatchesOptionalString(root, "path", metadata.Path)
                || !MatchesOccurredAt(root, metadata.OccurredAt)
                || !ValidatePart(root, "request") || !ValidatePart(root, "response"))
                return false;
            transaction = root.Clone();
            return true;
        }
        catch (JsonException) { return false; }
        catch (InvalidOperationException) { return false; }
        catch (FormatException) { return false; }
    }

    private static bool Matches(JsonElement root, string property, string expected) => root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String && string.Equals(value.GetString(), expected, StringComparison.Ordinal);
    private static bool MatchesOptionalString(JsonElement root, string property, string? expected) => expected is null || (root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String && string.Equals(value.GetString(), expected, StringComparison.Ordinal));
    private static bool MatchesOptionalInteger(JsonElement root, string property, int? expected) => expected is null || (root.TryGetProperty(property, out var value) && value.TryGetInt32(out var actual) && actual == expected);
    private static bool MatchesOccurredAt(JsonElement root, DateTimeOffset expected) => root.TryGetProperty("occurred_at", out var value) && value.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(value.GetString(), out var actual) && Math.Abs((actual.ToUniversalTime() - expected.ToUniversalTime()).TotalMilliseconds) < 1;

    private static bool ValidatePart(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var part) || part.ValueKind != JsonValueKind.Object
            || !part.TryGetProperty("original_size", out var original) || !original.TryGetInt64(out var originalSize)
            || !part.TryGetProperty("captured_size", out var captured) || !captured.TryGetInt32(out var capturedSize)
            || !part.TryGetProperty("truncated", out var truncated) || (truncated.ValueKind is not JsonValueKind.True and not JsonValueKind.False)
            || originalSize < 0 || capturedSize < 0 || capturedSize > DeploymentCenterConfigHelper.REQUEST_LOG_BODY_CAP_BYTES)
            return false;
        var raw = Array.Empty<byte>();
        if (part.TryGetProperty("body_base64", out var body))
        {
            if (body.ValueKind != JsonValueKind.String) return false;
            try { raw = Convert.FromBase64String(body.GetString() ?? string.Empty); }
            catch (FormatException) { return false; }
        }
        if (raw.Length != capturedSize || raw.Length > DeploymentCenterConfigHelper.REQUEST_LOG_BODY_CAP_BYTES) return false;
        if (!truncated.GetBoolean() && originalSize != capturedSize) return false;
        if (capturedSize > 0)
        {
            if (!part.TryGetProperty("captured_sha256", out var checksum) || checksum.ValueKind != JsonValueKind.String
                || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(checksum.GetString()!.ToLowerInvariant()), Encoding.ASCII.GetBytes(Convert.ToHexString(SHA256.HashData(raw)).ToLowerInvariant())))
                return false;
        }
        return ValidateHeaders(part) && ValidateParameters(part, "query_params") && ValidateParameters(part, "form_params");
    }

    private static bool ValidateHeaders(JsonElement part)
    {
        if (!part.TryGetProperty("headers", out var headers)) return true;
        if (headers.ValueKind != JsonValueKind.Object) return false;
        foreach (var header in headers.EnumerateObject())
        {
            var sensitive = IsSensitiveHeader(header.Name);
            if (!sensitive) continue;
            if (header.Value.ValueKind != JsonValueKind.Array || header.Value.EnumerateArray().Any(value => value.ValueKind != JsonValueKind.String || value.GetString() != "[REDACTED]")) return false;
        }
        return true;
    }

    private static bool IsSensitiveHeader(string name)
    {
        var normalized = name.Trim().ToLowerInvariant();
        return normalized is "authorization" or "proxy-authorization" or "cookie" or "set-cookie"
            || normalized.Contains("fctf") || normalized.Contains("token") || normalized.Contains("secret")
            || normalized.Contains("password") || normalized.Contains("api-key");
    }

    private static bool ValidateParameters(JsonElement part, string property)
    {
        if (!part.TryGetProperty(property, out var parameters)) return true;
        if (parameters.ValueKind != JsonValueKind.Array) return false;
        foreach (var parameter in parameters.EnumerateArray())
        {
            if (!parameter.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String
                || !parameter.TryGetProperty("values", out var values) || values.ValueKind != JsonValueKind.Array)
                return false;
            var sensitive = IsSensitiveParameter(name.GetString() ?? string.Empty);
            foreach (var value in values.EnumerateArray())
            {
                if (value.ValueKind != JsonValueKind.String) return false;
                if (sensitive && value.GetString() != "[REDACTED]") return false;
            }
        }
        return true;
    }

    private static bool IsSensitiveParameter(string name)
    {
        var normalized = name.Trim().ToLowerInvariant();
        return normalized == "authorization" || normalized.Contains("fctf") || normalized.Contains("token") || normalized.Contains("secret") || normalized.Contains("password")
            || normalized.Contains("cookie") || normalized.Contains("api_key") || normalized.Contains("api-key");
    }
}

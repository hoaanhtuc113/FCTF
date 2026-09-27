using System.Security.Cryptography;
using System.Text;

namespace DeploymentCenter.Services;

internal sealed class RequestLogObjectReader
{
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly Uri _endpoint;
    private readonly string _bucket;
    private readonly string _region;
    private readonly string _accessKey;
    private readonly string _secretKey;
    private readonly string? _sessionToken;
    private readonly bool _pathStyle;

    private RequestLogObjectReader(Uri endpoint, string bucket, string region, string accessKey, string secretKey, string? sessionToken, bool pathStyle)
    {
        _endpoint = endpoint;
        _bucket = bucket;
        _region = region;
        _accessKey = accessKey;
        _secretKey = secretKey;
        _sessionToken = sessionToken;
        _pathStyle = pathStyle;
    }

    public static RequestLogObjectReader? FromEnvironment()
    {
        var endpointValue = Environment.GetEnvironmentVariable("REQUEST_LOG_S3_READ_ENDPOINT");
        var bucket = Environment.GetEnvironmentVariable("REQUEST_LOG_S3_READ_BUCKET");
        var access = Environment.GetEnvironmentVariable("REQUEST_LOG_S3_READ_ACCESS_KEY");
        var secret = Environment.GetEnvironmentVariable("REQUEST_LOG_S3_READ_SECRET_KEY");
        if (string.IsNullOrWhiteSpace(endpointValue) || string.IsNullOrWhiteSpace(bucket)
            || string.IsNullOrWhiteSpace(access) || string.IsNullOrWhiteSpace(secret)
            || !Uri.TryCreate(endpointValue, UriKind.Absolute, out var endpoint)
            || endpoint.Scheme != Uri.UriSchemeHttps)
        {
            return null;
        }

        var pathStyleValue = Environment.GetEnvironmentVariable("REQUEST_LOG_S3_READ_PATH_STYLE");
        var pathStyle = !bool.TryParse(pathStyleValue, out var parsedPathStyle) || parsedPathStyle;
        return new RequestLogObjectReader(
            endpoint,
            bucket.Trim(),
            Environment.GetEnvironmentVariable("REQUEST_LOG_S3_READ_REGION") ?? "us-east-1",
            access,
            secret,
            Environment.GetEnvironmentVariable("REQUEST_LOG_S3_READ_SESSION_TOKEN"),
            pathStyle);
    }

    public async Task<(int StatusCode, byte[]? Content)> GetAsync(string key, CancellationToken cancellationToken = default)
    {
        if (!ValidKey(key))
            return (400, null);

        var escapedKey = string.Join("/", key.Split('/').Select(Uri.EscapeDataString));
        var endpointPath = _endpoint.AbsolutePath.TrimEnd('/');
        var host = _endpoint.Host;
        string objectPath;
        if (_pathStyle)
        {
            objectPath = $"{endpointPath}/{Uri.EscapeDataString(_bucket)}/{escapedKey}";
        }
        else
        {
            host = $"{_bucket}.{host}";
            objectPath = $"{endpointPath}/{escapedKey}";
        }

        var builder = new UriBuilder(_endpoint) { Host = host, Path = objectPath };
        using var request = new HttpRequestMessage(HttpMethod.Get, builder.Uri);
        Sign(request);
        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if ((int)response.StatusCode == 404 || (int)response.StatusCode == 410)
            return ((int)response.StatusCode, null);
        if (!response.IsSuccessStatusCode)
            return ((int)response.StatusCode, null);

        const int maxCompressedBytes = 8 * 1024 * 1024;
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var output = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0)
                break;
            if (output.Length + read > maxCompressedBytes)
                return (413, null);
            output.Write(buffer, 0, read);
        }
        return (200, output.ToArray());
    }

    private void Sign(HttpRequestMessage request)
    {
        var now = DateTimeOffset.UtcNow;
        var amzDate = now.ToString("yyyyMMdd'T'HHmmss'Z'");
        var shortDate = now.ToString("yyyyMMdd");
        var requestUri = request.RequestUri!;
        var headers = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["host"] = requestUri.IsDefaultPort ? requestUri.Host : requestUri.Authority,
            ["x-amz-content-sha256"] = "UNSIGNED-PAYLOAD",
            ["x-amz-date"] = amzDate
        };
        request.Headers.TryAddWithoutValidation("x-amz-content-sha256", "UNSIGNED-PAYLOAD");
        request.Headers.TryAddWithoutValidation("x-amz-date", amzDate);
        if (!string.IsNullOrWhiteSpace(_sessionToken))
        {
            headers["x-amz-security-token"] = _sessionToken;
            request.Headers.TryAddWithoutValidation("x-amz-security-token", _sessionToken);
        }

        var canonicalHeaders = string.Concat(headers.Select(pair => $"{pair.Key}:{string.Join(' ', pair.Value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))}\n"));
        var signedHeaders = string.Join(';', headers.Keys);
        var canonicalPath = "/" + requestUri.GetComponents(UriComponents.Path, UriFormat.UriEscaped).TrimStart('/');
        var canonicalRequest = string.Join('\n', "GET", canonicalPath, requestUri.Query.TrimStart('?'), canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD");
        var scope = $"{shortDate}/{_region}/s3/aws4_request";
        var requestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalRequest))).ToLowerInvariant();
        var stringToSign = $"AWS4-HMAC-SHA256\n{amzDate}\n{scope}\n{requestHash}";
        var signingKey = Hmac(Encoding.UTF8.GetBytes("AWS4" + _secretKey), shortDate);
        signingKey = Hmac(signingKey, _region);
        signingKey = Hmac(signingKey, "s3");
        signingKey = Hmac(signingKey, "aws4_request");
        var signature = Convert.ToHexString(Hmac(signingKey, stringToSign)).ToLowerInvariant();
        request.Headers.TryAddWithoutValidation("Authorization", $"AWS4-HMAC-SHA256 Credential={_accessKey}/{scope}, SignedHeaders={signedHeaders}, Signature={signature}");
    }

    private static byte[] Hmac(byte[] key, string value) => HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(value));

    private static bool ValidKey(string key)
    {
        if (!key.StartsWith("request-logs/", StringComparison.Ordinal) || key.Contains("..", StringComparison.Ordinal) || key.Length > 1024)
            return false;
        return key.Split('/').All(part => part.Length > 0 && part.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_' or '.'));
    }
}

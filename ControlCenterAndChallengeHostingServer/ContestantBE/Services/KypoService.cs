using ContestantBE.Utils;
using System.Net.Http.Headers;
using System.Text.Json;

namespace ContestantBE.Services;

public class KypoService
{
    private readonly HttpClient _http;
    private string? _token;
    private DateTimeOffset _expiresAt = DateTimeOffset.MinValue;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);

    public KypoService(IHttpClientFactory httpClientFactory)
    {
        _http = httpClientFactory.CreateClient("kypo");
    }

    private async Task<string> GetToken()
    {
        if (_token != null && DateTimeOffset.UtcNow < _expiresAt.AddSeconds(-30))
            return _token;

        await _tokenLock.WaitAsync();
        try
        {
            // Double-check after acquiring lock
            if (_token != null && DateTimeOffset.UtcNow < _expiresAt.AddSeconds(-30))
                return _token;

            var formFields = new Dictionary<string, string>
            {
                ["grant_type"] = "password",
                ["client_id"] = ContestantBEConfigHelper.KypoClientId,
                ["username"] = ContestantBEConfigHelper.KypoAdminUser,
                ["password"] = ContestantBEConfigHelper.KypoAdminPass,
            };
            if (!string.IsNullOrEmpty(ContestantBEConfigHelper.KypoClientSecret))
                formFields["client_secret"] = ContestantBEConfigHelper.KypoClientSecret;

            var tokenUrl = $"{ContestantBEConfigHelper.KypoBaseUrl}/keycloak/realms/{ContestantBEConfigHelper.KypoRealm}/protocol/openid-connect/token";
            var resp = await _http.PostAsync(tokenUrl, new FormUrlEncodedContent(formFields));

            if (!resp.IsSuccessStatusCode)
            {
                var errBody = await resp.Content.ReadAsStringAsync();
                throw new Exception($"KYPO token request failed ({(int)resp.StatusCode}) from {tokenUrl}: {errBody}");
            }
            var body = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            _token = root.GetProperty("access_token").GetString()!;
            var expiresIn = root.GetProperty("expires_in").GetInt32();
            _expiresAt = DateTimeOffset.UtcNow.AddSeconds(expiresIn);

            return _token;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    public async Task<byte[]> DownloadPoolSshConfig(int poolId)
    {
        var token = await GetToken();
        var url = $"{ContestantBEConfigHelper.KypoBaseUrl}/sandbox-service/api/v1/pools/{poolId}/management-ssh-access";
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await _http.SendAsync(request);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync();
            throw new Exception($"KYPO returned {(int)resp.StatusCode} from {url}: {body}");
        }
        return await resp.Content.ReadAsByteArrayAsync();
    }
}

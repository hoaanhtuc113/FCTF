using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text.Json;
using ContestantBE.Utils;

namespace ContestantBE.Services;

/// <summary>
/// Gọi KYPO API: lấy admin token từ Keycloak + Progress API.
/// </summary>
public class KypoApiClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<KypoApiClient> _logger;

    // ── KYPO service token (CRCZP realm) ──────────────────────
    private string?  _cachedToken;
    private DateTime _tokenExpiry = DateTime.MinValue;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);

    // ── Keycloak admin token (master realm) ───────────────────
    private string?  _cachedKcAdminToken;
    private DateTime _kcAdminTokenExpiry = DateTime.MinValue;
    private readonly SemaphoreSlim _kcTokenLock = new(1, 1);

    // ── Level count cache: instanceId → count (permanent) ─────
    private readonly ConcurrentDictionary<int, int> _levelCountCache = new();

    // ── Progress cache: instanceId → (expiry, data) TTL 20s ───
    private readonly ConcurrentDictionary<int, (DateTime Expiry, List<KypoProgressEntry> Data)> _progressCache = new();

    // ── RunTeam cache: training_run_id → team_id (singleton) ──
    public ConcurrentDictionary<int, int> RunTeamCache { get; } = new();

    public KypoApiClient(IHttpClientFactory httpClientFactory, ILogger<KypoApiClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    // ─────────────────────────────────────────────────────────
    // Admin token (CRCZP realm)
    // ─────────────────────────────────────────────────────────
    public async Task<string> GetAdminTokenAsync(string baseUrl)
    {
        await _tokenLock.WaitAsync();
        try
        {
            if (_cachedToken != null && DateTime.UtcNow < _tokenExpiry)
                return _cachedToken;

            var url = $"{baseUrl.TrimEnd('/')}/keycloak/realms/CRCZP/protocol/openid-connect/token";
            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "password",
                ["client_id"]  = ContestantBEConfigHelper.KypoClientId,
                ["username"]   = ContestantBEConfigHelper.KypoAdminUser,
                ["password"]   = ContestantBEConfigHelper.KypoAdminPass,
            };

            var client = _httpClientFactory.CreateClient("kypo");
            var resp   = await client.PostAsync(url, new FormUrlEncodedContent(form));
            resp.EnsureSuccessStatusCode();

            var json  = await resp.Content.ReadAsStringAsync();
            var token = JsonDocument.Parse(json).RootElement
                .GetProperty("access_token").GetString()
                ?? throw new Exception("Keycloak không trả về access_token");

            _cachedToken = token;
            _tokenExpiry = DateTime.UtcNow.AddMinutes(4);
            _logger.LogInformation("[KYPO] Admin token refreshed");
            return token;
        }
        finally { _tokenLock.Release(); }
    }

    // ─────────────────────────────────────────────────────────
    // Progress API — với in-memory cache TTL 20s
    // ─────────────────────────────────────────────────────────
    public async Task<List<KypoProgressEntry>> GetInstanceProgressAsync(
        string baseUrl, string instanceType, int instanceId)
    {
        if (_progressCache.TryGetValue(instanceId, out var hit) && DateTime.UtcNow < hit.Expiry)
            return hit.Data;

        var token   = await GetAdminTokenAsync(baseUrl);
        var service = instanceType == "adaptive" ? "adaptive-training" : "training";
        var url     = $"{baseUrl.TrimEnd('/')}/{service}/api/v1/visualizations/training-instances/{instanceId}/progress";

        var client = _httpClientFactory.CreateClient("kypo");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await client.GetAsync(url);
        if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            _cachedToken = null;
            token = await GetAdminTokenAsync(baseUrl);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            resp = await client.GetAsync(url);
        }

        resp.EnsureSuccessStatusCode();

        var json = await resp.Content.ReadAsStringAsync();
        var doc  = JsonDocument.Parse(json);
        var results = new List<KypoProgressEntry>();

        if (!doc.RootElement.TryGetProperty("progress", out var progressArr))
        {
            _progressCache[instanceId] = (DateTime.UtcNow.AddSeconds(20), results);
            return results;
        }

        foreach (var entry in progressArr.EnumerateArray())
        {
            var name   = entry.GetProperty("name").GetString() ?? "";
            var runId  = entry.TryGetProperty("training_run_id", out var rid) ? rid.GetInt32() : 0;
            var levels = new List<KypoLevelProgress>();

            if (entry.TryGetProperty("levels", out var levelsArr))
            {
                foreach (var lv in levelsArr.EnumerateArray())
                {
                    levels.Add(new KypoLevelProgress
                    {
                        Id    = lv.TryGetProperty("id",    out var id) ? id.GetInt32()   : 0,
                        State = lv.TryGetProperty("state", out var st) ? st.GetString()! : "",
                        Score = ExtractLevelScore(lv),
                    });
                }
            }

            results.Add(new KypoProgressEntry
            {
                Name       = name,
                RunId      = runId,
                IsFinished = levels.Count > 0 && levels.All(l => l.IsCompleted),
                TotalScore = levels.Sum(l => l.Score),
                Levels     = levels,
            });
        }

        _progressCache[instanceId] = (DateTime.UtcNow.AddSeconds(20), results);
        return results;
    }

    // ─────────────────────────────────────────────────────────
    // Training definition level count — với permanent cache
    // ─────────────────────────────────────────────────────────
    public async Task<int> GetTrainingDefinitionLevelCountAsync(
        string baseUrl, string instanceType, int instanceId)
    {
        if (_levelCountCache.TryGetValue(instanceId, out var cached) && cached > 0)
            return cached;

        var token   = await GetAdminTokenAsync(baseUrl);
        var service = instanceType == "adaptive" ? "adaptive-training" : "training";
        var url     = $"{baseUrl.TrimEnd('/')}/{service}/api/v1/training-instances/{instanceId}";

        var client = _httpClientFactory.CreateClient("kypo");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await client.GetAsync(url);
        if (!resp.IsSuccessStatusCode) return 0;

        var json = await resp.Content.ReadAsStringAsync();
        _logger.LogInformation("[KYPO LEVEL COUNT] instance={Id} raw JSON (first 500): {Json}",
            instanceId, json.Length > 500 ? json[..500] : json);

        var root = JsonDocument.Parse(json).RootElement;

        foreach (var defKey in new[] { "training_definition", "trainingDefinition" })
        {
            if (root.TryGetProperty(defKey, out var def))
            {
                foreach (var lvlKey in new[] { "levels", "phases" })
                {
                    if (def.TryGetProperty(lvlKey, out var lvls) && lvls.ValueKind == JsonValueKind.Array)
                    {
                        var count = lvls.GetArrayLength();
                        _levelCountCache[instanceId] = count;
                        return count;
                    }
                }
            }
        }

        foreach (var countKey in new[] { "level_count", "levelCount" })
        {
            if (root.TryGetProperty(countKey, out var cnt) && cnt.ValueKind == JsonValueKind.Number)
            {
                var count = cnt.GetInt32();
                _levelCountCache[instanceId] = count;
                return count;
            }
        }

        // Fallback: fetch training definition separately
        int? defId = null;
        foreach (var idKey in new[] { "training_definition_id", "trainingDefinitionId" })
        {
            if (root.TryGetProperty(idKey, out var idEl) && idEl.ValueKind == JsonValueKind.Number)
            {
                defId = idEl.GetInt32();
                break;
            }
        }

        if (defId.HasValue)
        {
            var defUrl  = $"{baseUrl.TrimEnd('/')}/{service}/api/v1/training-definitions/{defId}";
            var defResp = await client.GetAsync(defUrl);
            if (defResp.IsSuccessStatusCode)
            {
                var defRoot = JsonDocument.Parse(await defResp.Content.ReadAsStringAsync()).RootElement;
                foreach (var lvlKey in new[] { "levels", "phases" })
                {
                    if (defRoot.TryGetProperty(lvlKey, out var lvls) && lvls.ValueKind == JsonValueKind.Array)
                    {
                        var count = lvls.GetArrayLength();
                        _levelCountCache[instanceId] = count;
                        return count;
                    }
                }
            }
        }

        _logger.LogWarning("[KYPO LEVEL COUNT] instance={Id}: could not parse level count — guard will be skipped", instanceId);
        return 0;
    }

    // ─────────────────────────────────────────────────────────
    // Participant API — lấy sub (email) từ training_run_id
    // ─────────────────────────────────────────────────────────
    public async Task<string?> GetParticipantSubAsync(
        string baseUrl, string instanceType, int trainingRunId)
    {
        var token   = await GetAdminTokenAsync(baseUrl);
        var service = instanceType == "adaptive" ? "adaptive-training" : "training";
        var url     = $"{baseUrl.TrimEnd('/')}/{service}/api/v1/training-runs/{trainingRunId}/participant";

        var client = _httpClientFactory.CreateClient("kypo");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        try
        {
            var resp = await client.GetAsync(url);
            resp.EnsureSuccessStatusCode();
            var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            return doc.RootElement.TryGetProperty("sub", out var sub) ? sub.GetString() : null;
        }
        catch (Exception e)
        {
            _logger.LogWarning("[KYPO] Không lấy được participant run={Id}: {Msg}", trainingRunId, e.Message);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────
    // Keycloak Users API — lấy Keycloak UUID từ sub (email)
    // ─────────────────────────────────────────────────────────
    public async Task<string?> GetKeycloakUserIdBySubAsync(string baseUrl, string sub)
    {
        var token = await GetKeycloakAdminTokenAsync(baseUrl);
        var url   = $"{baseUrl.TrimEnd('/')}/keycloak/admin/realms/CRCZP/users?email={Uri.EscapeDataString(sub)}";

        var client = _httpClientFactory.CreateClient("kypo");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        try
        {
            var resp = await client.GetAsync(url);
            if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                _cachedKcAdminToken = null;
                token = await GetKeycloakAdminTokenAsync(baseUrl);
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                resp = await client.GetAsync(url);
            }
            resp.EnsureSuccessStatusCode();

            var users = JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement;
            if (users.GetArrayLength() == 0) return null;
            return users[0].TryGetProperty("id", out var id) ? id.GetString() : null;
        }
        catch (Exception e)
        {
            _logger.LogWarning("[KYPO] Không lấy được user id từ sub={Sub}: {Msg}", sub, e.Message);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────
    // Instance end_time cache
    // ─────────────────────────────────────────────────────────
    private readonly Dictionary<int, (DateTime? EndTime, DateTime CachedAt)> _endTimeCache = new();
    private readonly TimeSpan _endTimeCacheTtl = TimeSpan.FromMinutes(10);

    public async Task<DateTime?> GetInstanceEndTimeAsync(string baseUrl, string instanceType, int instanceId)
    {
        if (_endTimeCache.TryGetValue(instanceId, out var cached)
            && DateTime.UtcNow - cached.CachedAt < _endTimeCacheTtl)
            return cached.EndTime;

        var token   = await GetAdminTokenAsync(baseUrl);
        var service = instanceType == "adaptive" ? "adaptive-training" : "training";
        var url     = $"{baseUrl.TrimEnd('/')}/{service}/api/v1/training-instances/{instanceId}";

        var client = _httpClientFactory.CreateClient("kypo");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        try
        {
            var resp = await client.GetAsync(url);
            resp.EnsureSuccessStatusCode();

            var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            DateTime? endTime = null;
            if (doc.RootElement.TryGetProperty("end_time", out var endTimeProp)
                && endTimeProp.ValueKind != JsonValueKind.Null
                && DateTime.TryParse(endTimeProp.GetString(), out var parsed))
            {
                endTime = parsed.ToUniversalTime();
            }

            _endTimeCache[instanceId] = (endTime, DateTime.UtcNow);
            _logger.LogDebug("[KYPO] Instance {Id} end_time={EndTime}", instanceId, endTime);
            return endTime;
        }
        catch (Exception e)
        {
            _logger.LogWarning("[KYPO] Không lấy được end_time instance {Id}: {Msg}", instanceId, e.Message);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────

    private async Task<string> GetKeycloakAdminTokenAsync(string baseUrl)
    {
        await _kcTokenLock.WaitAsync();
        try
        {
            if (_cachedKcAdminToken != null && DateTime.UtcNow < _kcAdminTokenExpiry)
                return _cachedKcAdminToken;

            var url = $"{baseUrl.TrimEnd('/')}/keycloak/realms/master/protocol/openid-connect/token";
            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "password",
                ["client_id"]  = "admin-cli",
                ["username"]   = ContestantBEConfigHelper.KypoKeycloakAdminUser,
                ["password"]   = ContestantBEConfigHelper.KypoKeycloakAdminPass,
            };

            var client = _httpClientFactory.CreateClient("kypo");
            var resp   = await client.PostAsync(url, new FormUrlEncodedContent(form));
            resp.EnsureSuccessStatusCode();

            var token = JsonDocument.Parse(await resp.Content.ReadAsStringAsync())
                .RootElement.GetProperty("access_token").GetString()
                ?? throw new Exception("Không lấy được Keycloak admin token");

            _cachedKcAdminToken = token;
            _kcAdminTokenExpiry = DateTime.UtcNow.AddMinutes(4);
            return token;
        }
        finally { _kcTokenLock.Release(); }
    }

    private static int ExtractLevelScore(JsonElement level)
    {
        if (!level.TryGetProperty("events", out var events) || events.ValueKind != JsonValueKind.Array)
            return 0;

        var max = 0;
        foreach (var ev in events.EnumerateArray())
        {
            if (ev.TryGetProperty("actual_score_in_level", out var a) && a.ValueKind == JsonValueKind.Number)
                max = Math.Max(max, a.GetInt32());
            if (ev.TryGetProperty("max_score", out var m) && m.ValueKind == JsonValueKind.Number)
                max = Math.Max(max, m.GetInt32());
        }
        return max;
    }
}

// ─────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────
public class KypoProgressEntry
{
    public string Name       { get; set; } = "";
    public int    RunId      { get; set; }
    public bool   IsFinished { get; set; }
    public int    TotalScore { get; set; }
    public List<KypoLevelProgress> Levels { get; set; } = new();
}

public class KypoLevelProgress
{
    public int    Id    { get; set; }
    public string State { get; set; } = "";
    public int    Score { get; set; }
    public bool   IsCompleted => State == "FINISHED";
}

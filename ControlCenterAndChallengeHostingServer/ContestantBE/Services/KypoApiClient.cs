using System.Net.Http.Headers;
using System.Text.Json;

namespace ContestantBE.Services;

/// <summary>
/// KYPO API client: obtains admin tokens from Keycloak and calls the Progress API.
/// All token caches are protected by SemaphoreSlim to support concurrent callers.
/// </summary>
public class KypoApiClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<KypoApiClient> _logger;
    private readonly IKypoConfigProvider _kypoConfig;

    // ── KYPO service token (CRCZP realm) ──────────────────────
    private string?  _cachedToken;
    private DateTime _tokenExpiry = DateTime.MinValue;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);

    // ── Keycloak admin token (master realm) ───────────────────
    private string?  _cachedKcAdminToken;
    private DateTime _kcAdminTokenExpiry = DateTime.MinValue;
    private readonly SemaphoreSlim _kcTokenLock = new(1, 1);

    public KypoApiClient(IHttpClientFactory httpClientFactory, ILogger<KypoApiClient> logger, IKypoConfigProvider kypoConfig)
    {
        _httpClientFactory = httpClientFactory;
        _logger            = logger;
        _kypoConfig        = kypoConfig;
    }

    // ─────────────────────────────────────────────────────────
    // Admin token — cached for 4 min (Keycloak tokens live ~5 min)
    // Double-check lock: safe for concurrent callers
    // ─────────────────────────────────────────────────────────
    public async Task<string> GetAdminTokenAsync(string baseUrl, bool forceRefresh = false)
    {
        // Fast path: valid cached token, no lock needed
        if (!forceRefresh && _cachedToken != null && DateTime.UtcNow < _tokenExpiry)
            return _cachedToken;

        await _tokenLock.WaitAsync();
        try
        {
            // Double-check: another task may have refreshed the token while we waited
            if (!forceRefresh && _cachedToken != null && DateTime.UtcNow < _tokenExpiry)
                return _cachedToken;

            var url = $"{baseUrl.TrimEnd('/')}/keycloak/realms/CRCZP/protocol/openid-connect/token";
            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "password",
                ["client_id"]  = _kypoConfig.ClientId,
                ["username"]   = _kypoConfig.AdminUsername,
                ["password"]   = _kypoConfig.AdminPassword,
            };

            var client = _httpClientFactory.CreateClient("kypo");
            var resp   = await client.PostAsync(url, new FormUrlEncodedContent(form));
            resp.EnsureSuccessStatusCode();

            var json  = await resp.Content.ReadAsStringAsync();
            var doc   = JsonDocument.Parse(json);
            var token = doc.RootElement.GetProperty("access_token").GetString()
                ?? throw new Exception("Keycloak did not return access_token");

            _cachedToken = token;
            _tokenExpiry = DateTime.UtcNow.AddMinutes(4);

            _logger.LogInformation("[KYPO] Admin token refreshed");
            return _cachedToken;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    // ─────────────────────────────────────────────────────────
    // Progress API — returns progress list for all participants
    // ─────────────────────────────────────────────────────────
    public async Task<List<KypoProgressEntry>> GetInstanceProgressAsync(
        string baseUrl, string instanceType, int instanceId)
    {
        var token   = await GetAdminTokenAsync(baseUrl);
        var service = instanceType == "adaptive" ? "adaptive-training" : "training";
        var url     = $"{baseUrl.TrimEnd('/')}/{service}/api/v1/visualizations/training-instances/{instanceId}/progress";

        var client = _httpClientFactory.CreateClient("kypo");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await client.GetAsync(url);

        // Token expired mid-flight — force refresh and retry once
        if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            token = await GetAdminTokenAsync(baseUrl, forceRefresh: true);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            resp  = await client.GetAsync(url);
        }

        resp.EnsureSuccessStatusCode();

        var json = await resp.Content.ReadAsStringAsync();
        var doc  = JsonDocument.Parse(json);

        var results = new List<KypoProgressEntry>();

        if (!doc.RootElement.TryGetProperty("progress", out var progressArr))
            return results;

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
                        Id          = lv.TryGetProperty("id",    out var id) ? id.GetInt32()   : 0,
                        State       = lv.TryGetProperty("state", out var st) ? st.GetString()! : "",
                        Score       = ExtractLevelScore(lv),
                        IsCompleted = IsLevelCompleted(lv),
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

        return results;
    }

    /// <summary>
    /// Extracts a level's score from events[].actual_score_in_level (LevelCompleted event).
    /// The top-level "score" field can be reset to 0 by TrainingRunResumed — events are authoritative.
    /// </summary>
    private static int ExtractLevelScore(JsonElement level)
    {
        if (!level.TryGetProperty("events", out var events)
            || events.ValueKind != JsonValueKind.Array)
            return 0;

        var max = 0;
        foreach (var ev in events.EnumerateArray())
        {
            if (ev.TryGetProperty("actual_score_in_level", out var a)
                && a.ValueKind == JsonValueKind.Number)
                max = Math.Max(max, a.GetInt32());

            if (ev.TryGetProperty("max_score", out var m)
                && m.ValueKind == JsonValueKind.Number)
                max = Math.Max(max, m.GetInt32());
        }
        return max;
    }

    /// <summary>
    /// Returns true if a level is completed: state=FINISHED or a LevelCompleted event exists.
    /// Handles TrainingRunResumed which resets state=RUNNING after the level was already finished.
    /// </summary>
    private static bool IsLevelCompleted(JsonElement level)
    {
        var state = level.TryGetProperty("state", out var st) ? st.GetString() ?? "" : "";
        if (state.Equals("FINISHED", StringComparison.OrdinalIgnoreCase))
            return true;

        if (level.TryGetProperty("events", out var events)
            && events.ValueKind == JsonValueKind.Array)
        {
            foreach (var ev in events.EnumerateArray())
            {
                var type = ev.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
                if (type.Contains("LevelCompleted"))
                    return true;
            }
        }
        return false;
    }

    // ─────────────────────────────────────────────────────────
    // Keycloak admin token (master realm) — used to query users
    // Double-check lock: safe for concurrent callers
    // ─────────────────────────────────────────────────────────
    private async Task<string> GetKeycloakAdminTokenAsync(string baseUrl, bool forceRefresh = false)
    {
        if (!forceRefresh && _cachedKcAdminToken != null && DateTime.UtcNow < _kcAdminTokenExpiry)
            return _cachedKcAdminToken;

        await _kcTokenLock.WaitAsync();
        try
        {
            // Double-check inside lock
            if (!forceRefresh && _cachedKcAdminToken != null && DateTime.UtcNow < _kcAdminTokenExpiry)
                return _cachedKcAdminToken;

            var url = $"{baseUrl.TrimEnd('/')}/keycloak/realms/master/protocol/openid-connect/token";
            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "password",
                ["client_id"]  = "admin-cli",
                ["username"]   = _kypoConfig.KeycloakAdminUsername,
                ["password"]   = _kypoConfig.KeycloakAdminPassword,
            };

            var client = _httpClientFactory.CreateClient("kypo");
            var resp   = await client.PostAsync(url, new FormUrlEncodedContent(form));
            resp.EnsureSuccessStatusCode();

            var json  = await resp.Content.ReadAsStringAsync();
            var doc   = JsonDocument.Parse(json);
            var token = doc.RootElement.GetProperty("access_token").GetString()
                ?? throw new Exception("Keycloak did not return access_token for admin");

            _cachedKcAdminToken = token;
            _kcAdminTokenExpiry = DateTime.UtcNow.AddMinutes(4);
            return _cachedKcAdminToken;
        }
        finally
        {
            _kcTokenLock.Release();
        }
    }

    // ─────────────────────────────────────────────────────────
    // Participant API — get sub (email) from training_run_id
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

            var json = await resp.Content.ReadAsStringAsync();
            var doc  = JsonDocument.Parse(json);

            return doc.RootElement.TryGetProperty("sub", out var sub)
                ? sub.GetString()
                : null;
        }
        catch (Exception e)
        {
            _logger.LogWarning("[KYPO] Could not get participant for run={Id}: {Msg}", trainingRunId, e.Message);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────
    // Keycloak Users API — get Keycloak UUID from sub (email)
    // UUID is immutable and more reliable than username
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

            // Token expired mid-flight — force refresh and retry once
            if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                token = await GetKeycloakAdminTokenAsync(baseUrl, forceRefresh: true);
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                resp  = await client.GetAsync(url);
            }

            resp.EnsureSuccessStatusCode();

            var json  = await resp.Content.ReadAsStringAsync();
            var users = JsonDocument.Parse(json).RootElement;

            if (users.GetArrayLength() == 0) return null;

            // Return UUID (id field) — immutable, more reliable than username
            return users[0].TryGetProperty("id", out var id)
                ? id.GetString()
                : null;
        }
        catch (Exception e)
        {
            _logger.LogWarning("[KYPO] Could not get user id for sub={Sub}: {Msg}", sub, e.Message);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────
    // Instance API — get end_time of a training instance
    // Result is cached because end_time never changes
    // ─────────────────────────────────────────────────────────
    private readonly Dictionary<int, (DateTime? EndTime, DateTime CachedAt)> _endTimeCache = new();
    private readonly TimeSpan _endTimeCacheTtl = TimeSpan.FromMinutes(10);

    public async Task<DateTime?> GetInstanceEndTimeAsync(string baseUrl, string instanceType, int instanceId)
    {
        if (_endTimeCache.TryGetValue(instanceId, out var cached)
            && DateTime.UtcNow - cached.CachedAt < _endTimeCacheTtl)
        {
            return cached.EndTime;
        }

        var token   = await GetAdminTokenAsync(baseUrl);
        var service = instanceType == "adaptive" ? "adaptive-training" : "training";
        var url     = $"{baseUrl.TrimEnd('/')}/{service}/api/v1/training-instances/{instanceId}";

        var client = _httpClientFactory.CreateClient("kypo");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        try
        {
            var resp = await client.GetAsync(url);
            resp.EnsureSuccessStatusCode();

            var json = await resp.Content.ReadAsStringAsync();
            var doc  = JsonDocument.Parse(json);

            DateTime? endTime = null;
            if (doc.RootElement.TryGetProperty("end_time", out var endTimeProp)
                && endTimeProp.ValueKind != JsonValueKind.Null)
            {
                if (DateTime.TryParse(endTimeProp.GetString(), out var parsed))
                    endTime = parsed.ToUniversalTime();
            }

            _endTimeCache[instanceId] = (endTime, DateTime.UtcNow);

            _logger.LogDebug("[KYPO] Instance {Id} end_time={EndTime}", instanceId, endTime);
            return endTime;
        }
        catch (Exception e)
        {
            _logger.LogWarning("[KYPO] Could not get end_time for instance {Id}: {Msg}", instanceId, e.Message);
            return null;
        }
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
    public int    Id          { get; set; }
    public string State       { get; set; } = "";
    public int    Score       { get; set; }
    public bool   IsCompleted { get; set; }
}

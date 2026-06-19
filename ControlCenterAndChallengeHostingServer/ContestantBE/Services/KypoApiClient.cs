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

    // ── Level count cache: instanceId → count (never changes, cache forever) ──
    private readonly System.Collections.Concurrent.ConcurrentDictionary<int, int> _levelCountCache = new();

    // ── Progress cache: instanceId → (expiry, data) — TTL 20s ────────────────
    private readonly System.Collections.Concurrent.ConcurrentDictionary<int, (DateTime Expiry, List<KypoProgressEntry> Data)> _progressCache = new();
    private static readonly TimeSpan ProgressCacheTtl = TimeSpan.FromSeconds(15);

    // ── Participant caches (Singleton → persist across all requests) ──────────
    // runId → sub (email), sub → keycloakUserId, runId → teamId
    private readonly System.Collections.Concurrent.ConcurrentDictionary<int, string>    _runSubCache      = new();
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, string> _subKeycloakCache = new();
    public  readonly System.Collections.Concurrent.ConcurrentDictionary<int, int>       RunTeamCache      = new();

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
    // Training instance detail — returns expected level count
    // Used to guard against KYPO only returning started levels
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
        if (!resp.IsSuccessStatusCode)
            return 0;

        var json = await resp.Content.ReadAsStringAsync();
        _logger.LogInformation("[KYPO LEVEL COUNT] instance={Id} raw JSON (first 500 chars): {Json}",
            instanceId, json.Length > 500 ? json[..500] : json);
        var doc  = JsonDocument.Parse(json);
        var root = doc.RootElement;

        // Try: training_definition.levels[]
        foreach (var defKey in new[] { "training_definition", "trainingDefinition" })
        {
            if (root.TryGetProperty(defKey, out var def))
            {
                foreach (var lvlKey in new[] { "levels", "phases" })
                {
                    if (def.TryGetProperty(lvlKey, out var lvls)
                        && lvls.ValueKind == JsonValueKind.Array)
                    {
                        var count = lvls.GetArrayLength();
                        _levelCountCache[instanceId] = count;
                        return count;
                    }
                }
            }
        }

        // Try: level_count or levelCount at root
        foreach (var countKey in new[] { "level_count", "levelCount" })
        {
            if (root.TryGetProperty(countKey, out var cnt)
                && cnt.ValueKind == JsonValueKind.Number)
            {
                var count = cnt.GetInt32();
                _levelCountCache[instanceId] = count;
                return count;
            }
        }

        // If training definition levels not embedded, fetch separately
        int? defId = null;
        foreach (var idKey in new[] { "training_definition_id", "trainingDefinitionId" })
        {
            if (root.TryGetProperty(idKey, out var idEl)
                && idEl.ValueKind == JsonValueKind.Number)
            {
                defId = idEl.GetInt32();
                break;
            }
        }

        if (defId.HasValue)
        {
            var defUrl = $"{baseUrl.TrimEnd('/')}/{service}/api/v1/training-definitions/{defId}";
            var defResp = await client.GetAsync(defUrl);
            if (defResp.IsSuccessStatusCode)
            {
                var defJson = await defResp.Content.ReadAsStringAsync();
                var defDoc  = JsonDocument.Parse(defJson);
                foreach (var lvlKey in new[] { "levels", "phases" })
                {
                    if (defDoc.RootElement.TryGetProperty(lvlKey, out var lvls)
                        && lvls.ValueKind == JsonValueKind.Array)
                    {
                        var count = lvls.GetArrayLength();
                        _levelCountCache[instanceId] = count;
                        return count;
                    }
                }
            }
        }

        _logger.LogWarning("[KYPO LEVEL COUNT] instance={Id}: could not parse level count from JSON — guard will be skipped", instanceId);
        return 0;  // Unknown — caller treats 0 as "no constraint"
    }

    // ─────────────────────────────────────────────────────────
    // Progress API — returns progress list for all participants
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
        {
            _progressCache[instanceId] = (DateTime.UtcNow + ProgressCacheTtl, results);
            return results;
        }

        foreach (var entry in progressArr.EnumerateArray())
        {
            var name   = entry.TryGetProperty("name", out var nameEl) ? nameEl.GetString() ?? "" : "";
            var runId  = entry.TryGetProperty("training_run_id",  out var rid)  ? rid.GetInt32()
                       : entry.TryGetProperty("trainingRunId",    out var rid2) ? rid2.GetInt32()
                       : entry.TryGetProperty("id",               out var rid3) ? rid3.GetInt32()
                       : 0;
            _logger.LogDebug("[KYPO PROGRESS] instance={Id} entry: name={Name} runId={RunId}", instanceId, name, runId);
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
                        CompletedAt = ExtractCompletionTime(lv),
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

        _progressCache[instanceId] = (DateTime.UtcNow + ProgressCacheTtl, results);
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

    /// <summary>
    /// Returns the timestamp of the most recent LevelCompleted event, or null if unavailable.
    /// Tries common KYPO event timestamp field names.
    /// </summary>
    private static DateTime? ExtractCompletionTime(JsonElement level)
    {
        if (!level.TryGetProperty("events", out var events)
            || events.ValueKind != JsonValueKind.Array)
            return null;

        DateTime? latest = null;
        foreach (var ev in events.EnumerateArray())
        {
            var type = ev.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
            if (!type.Contains("LevelCompleted"))
                continue;

            // Try common KYPO timestamp field names
            foreach (var field in new[] { "occurred_at", "timestamp", "created_at", "happened_at", "event_time" })
            {
                if (!ev.TryGetProperty(field, out var ts)) continue;
                string? raw = ts.ValueKind == JsonValueKind.String ? ts.GetString() : null;
                if (raw == null) continue;
                if (DateTime.TryParse(raw, null,
                        System.Globalization.DateTimeStyles.RoundtripKind, out var dt))
                {
                    if (latest == null || dt > latest) latest = dt;
                    break;
                }
            }
        }
        return latest;
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
        if (_runSubCache.TryGetValue(trainingRunId, out var cachedSub))
            return cachedSub;

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

            var sub = doc.RootElement.TryGetProperty("sub", out var s) ? s.GetString() : null;
            if (sub != null) _runSubCache[trainingRunId] = sub;
            return sub;
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
        if (_subKeycloakCache.TryGetValue(sub, out var cachedId))
            return cachedId;

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
            var keycloakId = users[0].TryGetProperty("id", out var id) ? id.GetString() : null;
            if (keycloakId != null) _subKeycloakCache[sub] = keycloakId;
            return keycloakId;
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
    public int       Id          { get; set; }
    public string    State       { get; set; } = "";
    public int       Score       { get; set; }
    public bool      IsCompleted { get; set; }
    /// <summary>Timestamp of the LevelCompleted event (null if KYPO doesn't provide one).</summary>
    public DateTime? CompletedAt { get; set; }
}

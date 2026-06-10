using System.Net.Http.Headers;
using System.Text.Json;

namespace ContestantBE.Services;

/// <summary>
/// Gọi KYPO API: lấy admin token từ Keycloak + Progress API.
/// </summary>
public class KypoApiClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<KypoApiClient> _logger;
    private readonly IKypoConfigProvider _kypoConfig;

    // Cache token để tránh gọi Keycloak liên tục
    private string? _cachedToken;
    private DateTime _tokenExpiry = DateTime.MinValue;

    public KypoApiClient(IHttpClientFactory httpClientFactory, ILogger<KypoApiClient> logger, IKypoConfigProvider kypoConfig)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _kypoConfig = kypoConfig;
    }

    // ─────────────────────────────────────────────────────────
    // Lấy admin token (cache 4 phút, token Keycloak thường sống 5 phút)
    // ─────────────────────────────────────────────────────────
    public async Task<string> GetAdminTokenAsync(string baseUrl)
    {
        if (_cachedToken != null && DateTime.UtcNow < _tokenExpiry)
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
            ?? throw new Exception("Keycloak không trả về access_token");

        _cachedToken = token;
        _tokenExpiry = DateTime.UtcNow.AddMinutes(4);

        _logger.LogInformation("[KYPO] Lấy admin token thành công");
        return token;
    }

    // ─────────────────────────────────────────────────────────
    // Gọi Progress API → trả về danh sách progress của từng team
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

        // Token hết hạn → xóa cache, thử lại 1 lần
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
            return results;

        foreach (var entry in progressArr.EnumerateArray())
        {
            var name    = entry.GetProperty("name").GetString() ?? "";
            var runId   = entry.TryGetProperty("training_run_id", out var rid) ? rid.GetInt32() : 0;
            var levels  = new List<KypoLevelProgress>();

            if (entry.TryGetProperty("levels", out var levelsArr))
            {
                foreach (var lv in levelsArr.EnumerateArray())
                {
                    levels.Add(new KypoLevelProgress
                    {
                        Id    = lv.TryGetProperty("id",    out var id) ? id.GetInt32()   : 0,
                        State = lv.TryGetProperty("state", out var st) ? st.GetString()! : "",
                        // Field "score" KHÔNG tồn tại ở cấp level.
                        // Điểm của phase nằm trong events[].actual_score_in_level (= max_score của phase).
                        Score = ExtractLevelScore(lv),
                    });
                }
            }

            var isFinished  = levels.Count > 0 && levels.All(l => l.State == "FINISHED");
            var totalScore  = levels.Sum(l => l.Score);

            results.Add(new KypoProgressEntry
            {
                Name        = name,
                RunId       = runId,
                IsFinished  = isFinished,
                TotalScore  = totalScore,
                Levels      = levels,
            });
        }

        return results;
    }

    /// <summary>
    /// Lấy điểm của 1 phase (level) từ events[].
    /// KYPO không trả "score" trực tiếp ở level — điểm nằm trong events.
    /// Dùng giá trị lớn nhất của "actual_score_in_level" (hoặc "max_score").
    /// Mục đích: chỉ cần biết phase có điểm > 0 (phase tính điểm) hay = 0 (phase info/access).
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

    // ──────────────────────────────────────────────────────────
    // Keycloak Admin Token (master realm) — dùng để query users
    // ──────────────────────────────────────────────────────────
    private string? _cachedKcAdminToken;
    private DateTime _kcAdminTokenExpiry = DateTime.MinValue;

    private async Task<string> GetKeycloakAdminTokenAsync(string baseUrl)
    {
        if (_cachedKcAdminToken != null && DateTime.UtcNow < _kcAdminTokenExpiry)
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
            ?? throw new Exception("Không lấy được Keycloak admin token");

        _cachedKcAdminToken = token;
        _kcAdminTokenExpiry = DateTime.UtcNow.AddMinutes(4);
        return token;
    }

    // ──────────────────────────────────────────────────────────
    // Participant API — lấy sub (email) từ training_run_id
    // ──────────────────────────────────────────────────────────
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
            _logger.LogWarning("[KYPO] Không lấy được participant run={Id}: {Msg}", trainingRunId, e.Message);
            return null;
        }
    }

    // ──────────────────────────────────────────────────────────
    // Keycloak Users API — lấy Keycloak UUID từ sub (email)
    // UUID bất biến, chính xác hơn username
    // ──────────────────────────────────────────────────────────
    public async Task<string?> GetKeycloakUserIdBySubAsync(string baseUrl, string sub)
    {
        var token = await GetKeycloakAdminTokenAsync(baseUrl);
        var url   = $"{baseUrl.TrimEnd('/')}/keycloak/admin/realms/CRCZP/users?email={Uri.EscapeDataString(sub)}";

        var client = _httpClientFactory.CreateClient("kypo");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        try
        {
            var resp = await client.GetAsync(url);

            // Token hết hạn → xóa cache, thử lại 1 lần
            if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                _cachedKcAdminToken = null;
                token = await GetKeycloakAdminTokenAsync(baseUrl);
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                resp = await client.GetAsync(url);
            }

            resp.EnsureSuccessStatusCode();

            var json  = await resp.Content.ReadAsStringAsync();
            var users = JsonDocument.Parse(json).RootElement;

            if (users.GetArrayLength() == 0) return null;

            // Trả về UUID (id) thay vì username — UUID bất biến, chính xác hơn
            return users[0].TryGetProperty("id", out var id)
                ? id.GetString()
                : null;
        }
        catch (Exception e)
        {
            _logger.LogWarning("[KYPO] Không lấy được user id từ sub={Sub}: {Msg}", sub, e.Message);
            return null;
        }
    }

    // ──────────────────────────────────────────────────────────
    // Instance API — lấy end_time của training instance
    // Cache kết quả vì end_time không thay đổi
    // ──────────────────────────────────────────────────────────
    private readonly Dictionary<int, (DateTime? EndTime, DateTime CachedAt)> _endTimeCache = new();
    private readonly TimeSpan _endTimeCacheTtl = TimeSpan.FromMinutes(10);

    public async Task<DateTime?> GetInstanceEndTimeAsync(string baseUrl, string instanceType, int instanceId)
    {
        // Kiểm tra cache
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

            // Lưu cache
            _endTimeCache[instanceId] = (endTime, DateTime.UtcNow);

            _logger.LogDebug("[KYPO] Instance {Id} end_time={EndTime}", instanceId, endTime);
            return endTime;
        }
        catch (Exception e)
        {
            _logger.LogWarning("[KYPO] Không lấy được end_time instance {Id}: {Msg}", instanceId, e.Message);
            return null; // null → poll bình thường
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
    public int    Id    { get; set; }
    public string State { get; set; } = "";
    public int    Score { get; set; }
}

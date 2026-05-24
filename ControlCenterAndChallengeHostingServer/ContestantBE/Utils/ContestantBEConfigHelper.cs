namespace ContestantBE.Utils;

public class ContestantBEConfigHelper
{
    public static string DeploymentCenterAPI = "";
    public static string NFS_MOUNT_PATH = "";
    public static string REDIS_CONNECTION_STRING = "";
    public static string PRIVATE_KEY = "";
    public static string CLOUDFLARE_TURNSTILE_SECRET_KEY = "";

    // KYPO sandbox integration
    public static string KypoBaseUrl = "https://vuontre.iahn.hanoi.vn";
    public static string KypoRealm = "CRCZP";
    public static string KypoClientId = "CRCZP-Client";
    public static string KypoClientSecret = "";
    public static string KypoAdminUser = "";
    public static string KypoAdminPass = "";


    public static bool IsTurnstileEnabled => !string.IsNullOrWhiteSpace(CLOUDFLARE_TURNSTILE_SECRET_KEY);

    public void InitConfig()
    {
        REDIS_CONNECTION_STRING = GetRequiredEnv("REDIS_CONNECTION");
        PRIVATE_KEY = GetRequiredEnv("PRIVATE_KEY");
        DeploymentCenterAPI = GetRequiredEnv("DEPLOYMENT_SERVICE_API");
        NFS_MOUNT_PATH = GetRequiredEnv("NFS_MOUNT_PATH");
        CLOUDFLARE_TURNSTILE_SECRET_KEY = GetOptionalEnv("CLOUDFLARE_TURNSTILE_SECRET_KEY")
            ?? GetOptionalEnv("TURNSTILE_SECRET_KEY")
            ?? string.Empty;

        KypoBaseUrl = GetOptionalEnv("KYPO_BASE_URL") ?? KypoBaseUrl;
        KypoRealm = GetOptionalEnv("KYPO_REALM") ?? KypoRealm;
        KypoClientId = GetOptionalEnv("KYPO_CLIENT_ID") ?? KypoClientId;
        KypoAdminUser = GetOptionalEnv("KYPO_ADMIN_USER") ?? "";
        KypoAdminPass = GetOptionalEnv("KYPO_ADMIN_PASS") ?? "";
        KypoClientSecret = GetOptionalEnv("KYPO_CLIENT_SECRET") ?? "";
    }

    private static string GetRequiredEnv(string key)
    {
        return Environment.GetEnvironmentVariable(key)
            ?? throw new Exception($"Can't read env: {key}");
    }

    private static string? GetOptionalEnv(string key)
    {
        var value = Environment.GetEnvironmentVariable(key);
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}

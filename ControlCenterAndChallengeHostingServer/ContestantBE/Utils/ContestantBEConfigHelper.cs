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
    // Keycloak master admin (dùng để map training_run → team)
    public static string KypoKeycloakAdminUser = "admin";
    public static string KypoKeycloakAdminPass = "";
    // Polling interval cho KypoTimeoutWatcher (giây)
    public static int KypoPollIntervalSeconds = 10;

    public static bool IsTurnstileEnabled => !string.IsNullOrWhiteSpace(CLOUDFLARE_TURNSTILE_SECRET_KEY);

    /// <summary>
    /// Reads config from DB table first, falls back to ENV variables.
    /// DB keys match ManagementPlatform config table.
    /// </summary>
    public void InitConfig(string dbConnectionString)
    {
        using var db = DbConfigReader.BuildTempContext(dbConnectionString);

        REDIS_CONNECTION_STRING         = DbConfigReader.GetRequired(db, "redis_connection",               "REDIS_CONNECTION");
        PRIVATE_KEY                     = DbConfigReader.GetRequired(db, "private_key",                    "PRIVATE_KEY");
        DeploymentCenterAPI             = DbConfigReader.GetRequired(db, "deployment_service_api",         "DEPLOYMENT_SERVICE_API");
        NFS_MOUNT_PATH                  = DbConfigReader.GetRequired(db, "nfs_mount_path",                 "NFS_MOUNT_PATH");
        CLOUDFLARE_TURNSTILE_SECRET_KEY = DbConfigReader.GetOptional(db, "cloudflare_turnstile_secret_key",
                                              "CLOUDFLARE_TURNSTILE_SECRET_KEY", "TURNSTILE_SECRET_KEY")
                                          ?? string.Empty;

        KypoBaseUrl             = DbConfigReader.GetOptional(db, "kypo_base_url",      "KYPO_BASE_URL")      ?? KypoBaseUrl;
        KypoRealm               = DbConfigReader.GetOptional(db, "kypo_realm",         "KYPO_REALM")         ?? KypoRealm;
        KypoClientId            = DbConfigReader.GetOptional(db, "kypo_client_id",     "KYPO_CLIENT_ID")     ?? KypoClientId;
        KypoClientSecret        = DbConfigReader.GetOptional(db, "kypo_client_secret", "KYPO_CLIENT_SECRET") ?? "";
        KypoAdminUser           = DbConfigReader.GetOptional(db, "kypo_username",      "KYPO_ADMIN_USER")    ?? "";
        KypoAdminPass           = DbConfigReader.GetOptional(db, "kypo_password",      "KYPO_ADMIN_PASS")    ?? "";
        KypoKeycloakAdminUser   = DbConfigReader.GetOptional(db, "kypo_admin_username","KYPO_KEYCLOAK_ADMIN_USER") ?? "admin";
        KypoKeycloakAdminPass   = DbConfigReader.GetOptional(db, "kypo_admin_password","KYPO_KEYCLOAK_ADMIN_PASS") ?? "";

        var pollStr = DbConfigReader.GetOptional(db, "kypo_poll_interval_seconds", "KYPO_POLL_INTERVAL_SECONDS");
        KypoPollIntervalSeconds = int.TryParse(pollStr, out var kpi) ? kpi : 10;
    }
}

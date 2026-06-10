namespace ContestantBE.Utils;

public class ContestantBEConfigHelper
{
    public static string DeploymentCenterAPI = "";
    public static string NFS_MOUNT_PATH = "";
    public static string REDIS_CONNECTION_STRING = "";
    public static string PRIVATE_KEY = "";
    public static string CLOUDFLARE_TURNSTILE_SECRET_KEY = "";

    public static bool IsTurnstileEnabled => !string.IsNullOrWhiteSpace(CLOUDFLARE_TURNSTILE_SECRET_KEY);

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
    }
}

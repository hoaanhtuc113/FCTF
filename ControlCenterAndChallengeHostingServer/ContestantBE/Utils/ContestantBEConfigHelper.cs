namespace ContestantBE.Utils;

public class ContestantBEConfigHelper
{
    public static string DeploymentCenterAPI = "";
    public static string NFS_MOUNT_PATH = "";
    public static string REDIS_CONNECTION_STRING = "";
    public static string PRIVATE_KEY = "";

    public void InitConfig()
    {
        REDIS_CONNECTION_STRING = GetRequiredEnv("REDIS_CONNECTION");
        PRIVATE_KEY = GetRequiredEnv("PRIVATE_KEY");
        DeploymentCenterAPI = GetRequiredEnv("DEPLOYMENT_SERVICE_API");
        NFS_MOUNT_PATH = GetRequiredEnv("NFS_MOUNT_PATH");
    }

    private static string GetRequiredEnv(string key)
    {
        return Environment.GetEnvironmentVariable(key)
            ?? throw new Exception($"Can't read env: {key}");
    }
}

namespace DeploymentCenter.Utils;

public class DeploymentCenterConfigHelper
{
    public static string REDIS_CONNECTION_STRING = "";
    public static string PRIVATE_KEY = "";
    public static string RABBIT_HOST = "";
    public static string RABBIT_USERNAME = "";
    public static string RABBIT_PASSWORD = "";
    public static string RABBIT_VHOST = "/";
    public static int RABBIT_PORT = 5672;

    public static string ARGO_WORKFLOWS_URL = "";
    public static string ARGO_WORKFLOWS_TOKEN = "";
    public static string POD_START_TIMEOUT_MINUTES = "";
    public static string LOKI_BASE_URL = "http://loki-stack:3100";
    public static string LOKI_QUERY_SELECTOR = "{app=\"challenge-gateway\"}";

    public static int DEPLOYMENT_QUEUE_TIMEOUT_MINUTES = 5;

    public void InitConfig()
    {
        REDIS_CONNECTION_STRING = GetRequiredEnv("REDIS_CONNECTION");
        PRIVATE_KEY = GetRequiredEnv("PRIVATE_KEY");
        RABBIT_HOST = GetRequiredEnv("RABBIT_HOST");
        RABBIT_USERNAME = GetRequiredEnv("RABBIT_USERNAME");
        RABBIT_PASSWORD = GetRequiredEnv("RABBIT_PASSWORD");
        RABBIT_VHOST = Environment.GetEnvironmentVariable("RABBIT_VHOST") ?? "/";
        RABBIT_PORT = int.TryParse(GetRequiredEnv("RABBIT_PORT"), out var rabbitPort) ? rabbitPort : throw new Exception("Invalid RABBIT_PORT");

        ARGO_WORKFLOWS_URL = GetRequiredEnv("ARGO_WORKFLOWS_URL");
        ARGO_WORKFLOWS_TOKEN = GetRequiredEnv("ARGO_WORKFLOWS_TOKEN");
        POD_START_TIMEOUT_MINUTES = Environment.GetEnvironmentVariable("POD_START_TIMEOUT_MINUTES") ?? "5";
        LOKI_BASE_URL = Environment.GetEnvironmentVariable("LOKI_BASE_URL") ?? "http://loki-stack:3100";
        LOKI_QUERY_SELECTOR = Environment.GetEnvironmentVariable("LOKI_QUERY_SELECTOR") ?? "{app=\"challenge-gateway\"}";

        if (string.IsNullOrWhiteSpace(LOKI_BASE_URL))
        {
            LOKI_BASE_URL = "http://loki-stack:3100";
        }
        if (string.IsNullOrWhiteSpace(LOKI_QUERY_SELECTOR))
        {
            LOKI_QUERY_SELECTOR = "{app=\"challenge-gateway\"}";
        }

        var deploymentQueueTimeoutRaw = Environment.GetEnvironmentVariable("DEPLOYMENT_QUEUE_TIMEOUT_MINUTES") ?? "5";
        if (!int.TryParse(deploymentQueueTimeoutRaw, out var deploymentQueueTimeoutMinutes) || deploymentQueueTimeoutMinutes <= 0)
        {
            deploymentQueueTimeoutMinutes = 5;
        }

        DEPLOYMENT_QUEUE_TIMEOUT_MINUTES = deploymentQueueTimeoutMinutes;
    }

    private static string GetRequiredEnv(string key)
    {
        return Environment.GetEnvironmentVariable(key)
            ?? throw new Exception($"Can't read env: {key}");
    }
}

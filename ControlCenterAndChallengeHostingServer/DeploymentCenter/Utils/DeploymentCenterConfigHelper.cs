using ResourceShared.Utils;

namespace DeploymentCenter.Utils;

public class DeploymentCenterConfigHelper : SharedConfig
{
    public static string ARGO_WORKFLOWS_URL = "";
    public static string ARGO_WORKFLOWS_TOKEN = "";
    public static string POD_START_TIMEOUT_MINUTES = "";
    public static string LOKI_BASE_URL = "http://loki-stack:3100";
    public static string LOKI_QUERY_SELECTOR = "{app=\"challenge-gateway\"}";

    public static int DEPLOYMENT_QUEUE_TIMEOUT_MINUTES = 5;

    public override void InitConfig()
    {
        base.InitConfig();
        ARGO_WORKFLOWS_URL = configuration["ARGO_WORKFLOWS_URL"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_URL");
        ARGO_WORKFLOWS_TOKEN = configuration["ARGO_WORKFLOWS_TOKEN"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_TOKEN");
        POD_START_TIMEOUT_MINUTES = configuration["POD_START_TIMEOUT_MINUTES"] ?? "5";
        LOKI_BASE_URL = configuration["LOKI_BASE_URL"] ?? "http://loki-stack:3100";
        LOKI_QUERY_SELECTOR = configuration["LOKI_QUERY_SELECTOR"] ?? "{app=\"challenge-gateway\"}";

        if (string.IsNullOrWhiteSpace(LOKI_BASE_URL))
        {
            LOKI_BASE_URL = "http://loki-stack:3100";
        }
        if (string.IsNullOrWhiteSpace(LOKI_QUERY_SELECTOR))
        {
            LOKI_QUERY_SELECTOR = "{app=\"challenge-gateway\"}";
        }

        var deploymentQueueTimeoutRaw = configuration["DEPLOYMENT_QUEUE_TIMEOUT_MINUTES"] ?? "5";
        if (!int.TryParse(deploymentQueueTimeoutRaw, out var deploymentQueueTimeoutMinutes) || deploymentQueueTimeoutMinutes <= 0)
        {
            deploymentQueueTimeoutMinutes = 5;
        }

        DEPLOYMENT_QUEUE_TIMEOUT_MINUTES = deploymentQueueTimeoutMinutes;
    }
}

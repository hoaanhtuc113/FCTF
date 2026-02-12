using ResourceShared.Utils;

namespace DeploymentCenter.Utils;

public class DeploymentCenterConfigHelper : SharedConfig
{
    public static string ARGO_WORKFLOWS_URL = "";
    public static string ARGO_WORKFLOWS_TOKEN = "";
    public static string POD_START_TIMEOUT_MINUTES = "";

    public static int DEPLOYMENT_QUEUE_TIMEOUT_MINUTES = 5;

    public override void InitConfig()
    {
        base.InitConfig();
        ARGO_WORKFLOWS_URL = configuration["ARGO_WORKFLOWS_URL"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_URL");
        ARGO_WORKFLOWS_TOKEN = configuration["ARGO_WORKFLOWS_TOKEN"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_TOKEN");
        POD_START_TIMEOUT_MINUTES = configuration["POD_START_TIMEOUT_MINUTES"] ?? "5";

        var deploymentQueueTimeoutRaw = configuration["DEPLOYMENT_QUEUE_TIMEOUT_MINUTES"] ?? "5";
        if (!int.TryParse(deploymentQueueTimeoutRaw, out var deploymentQueueTimeoutMinutes) || deploymentQueueTimeoutMinutes <= 0)
        {
            deploymentQueueTimeoutMinutes = 5;
        }

        DEPLOYMENT_QUEUE_TIMEOUT_MINUTES = deploymentQueueTimeoutMinutes;
    }
}

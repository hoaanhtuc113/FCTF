using ResourceShared.Utils;

namespace DeploymentConsumer;

public class DeploymentConsumerConfigHelper : SharedConfig
{
    public static string ARGO_WORKFLOWS_URL = "";
    public static string ARGO_WORKFLOWS_TOKEN = "";
    public static string POD_START_TIMEOUT_MINUTES = "";

    public static int ARGO_DEPLOY_TTL_MINUTES = 6;

    public override void InitConfig()
    {
        base.InitConfig();
        ARGO_WORKFLOWS_URL = configuration["ARGO_WORKFLOWS_URL"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_URL");
        ARGO_WORKFLOWS_TOKEN = configuration["ARGO_WORKFLOWS_TOKEN"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_TOKEN");

        POD_START_TIMEOUT_MINUTES = configuration["POD_START_TIMEOUT_MINUTES"] ?? "5";

        var queueTimeoutMinutesRaw = configuration["ARGO_DEPLOY_TTL_MINUTES"] ?? "6";
        if (int.TryParse(queueTimeoutMinutesRaw, out var queueTimeoutMinutesParsed) && queueTimeoutMinutesParsed > 0)
        {
            ARGO_DEPLOY_TTL_MINUTES = queueTimeoutMinutesParsed;
        }
    }
}

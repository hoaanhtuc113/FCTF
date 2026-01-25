using ResourceShared.Utils;

namespace DeploymentConsumer;

public class DeploymentConsumerConfigHelper : SharedConfig
{
    public static string ARGO_WORKFLOWS_URL = "";
    public static string ARGO_WORKFLOWS_TOKEN = "";
    public static string CPU_LIMIT = "";
    public static string MEMORY_LIMIT = "";
    public static string CPU_REQUEST = "";
    public static string MEMORY_REQUEST = "";
    public static string POD_START_TIMEOUT_MINUTES = "";

    public override void InitConfig()
    {
        base.InitConfig();
        DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_URL = configuration["ARGO_WORKFLOWS_URL"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_URL");
        DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_TOKEN = configuration["ARGO_WORKFLOWS_TOKEN"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_TOKEN");
        DeploymentConsumerConfigHelper.CPU_LIMIT = configuration["CPU_LIMIT"] ?? "300m";
        DeploymentConsumerConfigHelper.CPU_REQUEST = configuration["CPU_REQUEST"] ?? "300m";
        DeploymentConsumerConfigHelper.MEMORY_LIMIT = configuration["MEMORY_LIMIT"] ?? "256Mi";
        DeploymentConsumerConfigHelper.MEMORY_REQUEST = configuration["MEMORY_REQUEST"] ?? "256Mi";
        DeploymentConsumerConfigHelper.POD_START_TIMEOUT_MINUTES = configuration["POD_START_TIMEOUT_MINUTES"] ?? "5";
    }
}

using ResourceShared.Utils;

namespace DeploymentService.Utils
{
    public class DeploymentServiceConfigHelper : SharedConfig
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
            DeploymentServiceConfigHelper.ARGO_WORKFLOWS_URL = configuration["ARGO_WORKFLOWS_URL"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_URL");
            DeploymentServiceConfigHelper.ARGO_WORKFLOWS_TOKEN = configuration["ARGO_WORKFLOWS_TOKEN"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_TOKEN");
            DeploymentServiceConfigHelper.CPU_LIMIT = configuration["CPU_LIMIT"] ?? "300m";
            DeploymentServiceConfigHelper.CPU_REQUEST = configuration["CPU_REQUEST"] ?? "300m";
            DeploymentServiceConfigHelper.MEMORY_LIMIT = configuration["MEMORY_LIMIT"] ?? "256Mi";
            DeploymentServiceConfigHelper.MEMORY_REQUEST = configuration["MEMORY_REQUEST"] ?? "256Mi";
            DeploymentServiceConfigHelper.POD_START_TIMEOUT_MINUTES = configuration["POD_START_TIMEOUT_MINUTES"] ?? "5";
        }
    }
}

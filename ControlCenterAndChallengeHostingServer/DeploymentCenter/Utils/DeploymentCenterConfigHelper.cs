using ResourceShared.Utils;

namespace DeploymentCenter.Utils
{
    public class DeploymentCenterConfigHelper : SharedConfig
    {
        public static string ARGO_WORKFLOWS_URL = "";
        public static string ARGO_WORKFLOWS_TOKEN = "";
        public static string CPU_LIMIT = "";
        public static string MEMORY_LIMIT = "";
        public static string CPU_REQUEST = "";
        public static string MEMORY_REQUEST = "";
        public static string POD_START_TIMEOUT_MINUTES = "";
        public static int WORKER_SERVICE_INTERVAL;

        public override void InitConfig()
        {
            base.InitConfig();
            DeploymentCenterConfigHelper.ARGO_WORKFLOWS_URL = configuration["ARGO_WORKFLOWS_URL"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_URL");
            DeploymentCenterConfigHelper.ARGO_WORKFLOWS_TOKEN = configuration["ARGO_WORKFLOWS_TOKEN"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_TOKEN");
            DeploymentCenterConfigHelper.CPU_LIMIT = configuration["CPU_LIMIT"] ?? "300m";
            DeploymentCenterConfigHelper.CPU_REQUEST = configuration["CPU_REQUEST"] ?? "300m";
            DeploymentCenterConfigHelper.MEMORY_LIMIT = configuration["MEMORY_LIMIT"] ?? "256Mi";
            DeploymentCenterConfigHelper.MEMORY_REQUEST = configuration["MEMORY_REQUEST"] ?? "256Mi";
            DeploymentCenterConfigHelper.POD_START_TIMEOUT_MINUTES = configuration["POD_START_TIMEOUT_MINUTES"] ?? "5";
            DeploymentCenterConfigHelper.WORKER_SERVICE_INTERVAL = int.Parse(configuration["WORKER_SERVICE_INTERVAL"] ?? "20");
        }
    }
}

using ResourceShared.Utils;

namespace DeploymentService.Utils
{
    public class DeploymentServiceConfigHelper : SharedConfig
    {
        public static string ARGO_WORKFLOWS_URL = "";
        public static string ARGO_WORKFLOWS_TOKEN = "";
        public override void InitConfig()
        {
            base.InitConfig();
            DeploymentServiceConfigHelper.ARGO_WORKFLOWS_URL = configuration["ARGO_WORKFLOWS_URL"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_URL");
            DeploymentServiceConfigHelper.ARGO_WORKFLOWS_TOKEN = configuration["ARGO_WORKFLOWS_TOKEN"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_TOKEN");
        }
    }
}

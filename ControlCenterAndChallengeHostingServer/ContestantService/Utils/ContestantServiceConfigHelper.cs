using ResourceShared.Configs;
using ResourceShared.Utils;
using static System.Net.WebRequestMethods;

namespace ContestantService.Utils
{
    public class ContestantServiceConfigHelper : SharedConfig
    {
        public static string ControlServerAPI = "";
        public static string ARGO_WORKFLOWS_URL = "";
        public static string ARGO_WORKFLOWS_TOKEN = "";
        public static string NFS_PATH = "";

        public override void InitConfig()
        {
            base.InitConfig();
            ContestantServiceConfigHelper.ControlServerAPI = configuration["ServiceConfigs:ControlServerAPI"] ?? throw new Exception("Can't read ServiceConfigs:ControlServerAPI");
            ContestantServiceConfigHelper.ARGO_WORKFLOWS_URL = configuration["ServiceConfigs:ArgoWorkflowsURL"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_URL");
            ContestantServiceConfigHelper.ARGO_WORKFLOWS_TOKEN = configuration["ServiceConfigs:ArgoWorkflowsToken"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_TOKEN");
            ContestantServiceConfigHelper.NFS_PATH = configuration["ServiceConfigs:NfsPath"] ?? throw new Exception("Can't read ServiceConfigs:NFS_PATH");
        }
    }
}

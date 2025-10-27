using ResourceShared.Configs;
using ResourceShared.Utils;
using static System.Net.WebRequestMethods;

namespace ContestantService.Utils
{
    public class ContestantServiceConfigHelper : SharedConfig
    {
        public static string ControlServerAPI = "";
        public static string DeploymentServiceAPI = "";
        public static string NFS_MOUNT_PATH = "";

        public override void InitConfig()
        {
            base.InitConfig();
            ServiceConfigs.SecretKey = configuration["SECRET_KEY"] ?? throw new Exception("Can't read ServiceConfigs:SecretKey");
            ContestantServiceConfigHelper.ControlServerAPI = configuration["CONTROL_SERVER_API"] ?? throw new Exception("Can't read ServiceConfigs:ControlServerAPI");
            ContestantServiceConfigHelper.DeploymentServiceAPI = configuration["DEPLOYMENT_SERVICE_API"] ?? throw new Exception("Can't read ServiceConfigs:DEPLOYMENT_SERVICE_API");
            ContestantServiceConfigHelper.NFS_MOUNT_PATH = configuration["NFS_MOUNT_PATH"] ?? throw new Exception("Can't read ServiceConfigs:NFS_MOUNT_PATH");
        }
    }
}

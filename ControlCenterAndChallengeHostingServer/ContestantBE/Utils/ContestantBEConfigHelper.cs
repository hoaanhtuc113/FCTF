using ResourceShared.Configs;
using ResourceShared.Utils;
using static System.Net.WebRequestMethods;

namespace ContestantBE.Utils
{
    public class ContestantBEConfigHelper : SharedConfig
    {
        public static string DeploymentCenterAPI = "";
        public static string NFS_MOUNT_PATH = "";

        public override void InitConfig()
        {
            base.InitConfig();
            DeploymentCenterAPI = configuration["DEPLOYMENT_SERVICE_API"] ?? throw new Exception("Can't read ServiceConfigs:DEPLOYMENT_SERVICE_API");
            NFS_MOUNT_PATH = configuration["NFS_MOUNT_PATH"] ?? throw new Exception("Can't read ServiceConfigs:NFS_MOUNT_PATH");
        }
    }
}

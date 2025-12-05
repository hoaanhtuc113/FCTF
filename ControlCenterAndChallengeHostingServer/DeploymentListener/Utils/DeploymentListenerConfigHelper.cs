using ResourceShared.Utils;

namespace DeploymentListener.Utils
{
    public class DeploymentListenerConfigHelper : SharedConfig
    {
        public static int WORKER_SERVICE_INTERVAL;
        public static string CONTESTANT_BE_API = "";

        public override void InitConfig()
        {
            base.InitConfig();
            DeploymentListenerConfigHelper.WORKER_SERVICE_INTERVAL = int.Parse(configuration["WORKER_SERVICE_INTERVAL"] ?? "20");
            DeploymentListenerConfigHelper.CONTESTANT_BE_API = configuration["CONTESTANT_BE_API"] ?? throw new Exception("Can't read ServiceConfigs:CONTESTANT_BE_API");
        }
    }
}
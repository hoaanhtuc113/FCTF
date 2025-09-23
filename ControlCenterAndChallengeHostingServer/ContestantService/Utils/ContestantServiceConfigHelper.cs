using ResourceShared.Configs;
using ResourceShared.Utils;
using static System.Net.WebRequestMethods;

namespace ContestantService.Utils
{
    public class ContestantServiceConfigHelper : SharedConfig
    {
        public static string ControlServerAPI = "";

        public override void InitConfig()
        {
            base.InitConfig();
            ContestantServiceConfigHelper.ControlServerAPI = configuration["ServiceConfigs:ControlServerAPI"] ?? throw new Exception("Can't read ServiceConfigs:ControlServerAPI");
        }
    }
}

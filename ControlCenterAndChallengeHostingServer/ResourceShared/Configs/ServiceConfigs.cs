using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.Configs
{
    public class ServiceConfigs
    {
        public static string PrivateKey = "";

        public static string CTFdBaseUrl = "";

        public static string K8sPort = "8001";

        public static string ServerHost = "";

        public static string ServerPort = "";

        public static string DomainName = "";

        public static int MaxInstanceAtTime = 3;
        public static int PwnPortRangeFrom = -1;
        public static int PwnPortRangeTo = -1;

    }
}

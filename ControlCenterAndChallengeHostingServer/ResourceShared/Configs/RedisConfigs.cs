using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.Configs
{
    public class RedisConfigs
    {
        public static string ConnectionString = "localhost:6379";
        public static string RedisChallengeTestKey = "CS_Deploy_Test_Challange_";
        public static string RedisDeployKey = "CS_Deploy_Chal_";
        public static string RedisChallengeDeploymentListKey = "CS_Challenge_Deployment_List";
        public static string RedisStartedChallengeKey = "Started_Challenge";
        //public static string PodsInfoKey = "Pods_Info";
    }
}

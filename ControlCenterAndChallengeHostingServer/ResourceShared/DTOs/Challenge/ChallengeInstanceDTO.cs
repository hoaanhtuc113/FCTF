using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeInstanceDTO
    {
        public int challenge_id { get; set; }
        public string challenge_name { get; set; }
        public string category { get; set; }
        public string status { get; set; }
        public string pod_name { get; set; }
        public string challenge_url { get; set; }
        public bool ready { get; set; }
        /// <summary>Deprecated expiration alias: Unix seconds as a string, or "-1" for no expiration. Use expires_at.</summary>
        public string age { get; set; }
        /// <summary>Expiration in Unix seconds, or null when the instance has no expiration.</summary>
        public long? expires_at { get; set; }
    }
}

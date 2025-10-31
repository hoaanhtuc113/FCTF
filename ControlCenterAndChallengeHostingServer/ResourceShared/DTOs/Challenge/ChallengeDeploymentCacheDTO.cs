using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeDeploymentCacheDTO
    {
        public int challenge_id { get; set; }
        public int user_id { get; set; }
        public string? challenge_url { get; set; }
        public long time_finished { get; set; }
        public string? status { get; set; }
    }
}

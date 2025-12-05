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
        public int team_id { get; set; }
        public string? _namespace { get; set; } = string.Empty;
        public string? pod_id { get; set; } = string.Empty;
        public string? workflow_name { get; set; } = string.Empty;
        public string? challenge_url { get; set; } = string.Empty;
        public long time_finished { get; set; }
        public string? status { get; set; }
        public bool ready { get; set; } = false;
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeByCategoryDTO
    {
        public int id { get; set; }
        public string name { get; set; } = "";
        public int? next_id { get; set; }
        // human readable name of the next challenge
        public string? next_name { get; set; }
        public int? max_attempts { get; set; }
        public int? value { get; set; }
        public string? category { get; set; }
        public int? time_limit { get; set; }
        public string connection_protocol { get; set; } = "http";
        public string? type { get; set; }
        public ChallengeRequirementsDTO? requirements { get; set; }
        public bool solve_by_myteam { get; set; }
        public string? pod_status { get; set; } = null;
        public int? difficulty { get; set; }
        public bool shared_instance { get; set; }

    }
}

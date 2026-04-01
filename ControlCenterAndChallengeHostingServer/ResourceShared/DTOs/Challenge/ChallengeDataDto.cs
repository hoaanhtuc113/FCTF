using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeDataDto
    {
        public int id { get; set; }
        public string name { get; set; } = "";
        public string description { get; set; } = "";
        public int? max_attempts { get; set; }
        public int attemps { get; set; }
        public int? max_deploy_count { get; set; }
        public int deployed_count { get; set; }
        public string? category { get; set; }
        public int? time_limit { get; set; }
        public bool require_deploy { get; set; }
        public string connection_protocol { get; set; } = "http";
        public string? type { get; set; }
        public int? next_id { get; set; }
        // name of the challenge referenced by next_id, for UI convenience
        public string? next_name { get; set; }
        public bool solve_by_myteam { get; set; }
        public List<object> files { get; set; } = new();
        public bool is_captain { get; set; }
        public bool captain_only_start { get; set; }
        public bool captain_only_submit { get; set; }
        public int? difficulty { get; set; }
        public bool shared_instance { get; set; }
    }
}

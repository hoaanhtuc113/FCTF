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
        public string? category { get; set; }
        public int? time_limit { get; set; }
        public bool require_deploy { get; set; }
        public string? type { get; set; }
        public int? next_id { get; set; }
        public bool solve_by_myteam { get; set; }
        public List<object> files { get; set; } = new();
        public bool is_captain { get; set; }
        public bool captain_only_start { get; set; }
        public bool captain_only_submit { get; set; }
    }
}

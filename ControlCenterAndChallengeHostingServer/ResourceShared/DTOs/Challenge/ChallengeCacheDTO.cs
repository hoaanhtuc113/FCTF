using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeCacheDTO
    {
        public int challenge_id { get; set; }
        public int user_id { get; set; }
        public string? challenge_url { get; set; }
        public int time_finished { get; set; }
    }
}

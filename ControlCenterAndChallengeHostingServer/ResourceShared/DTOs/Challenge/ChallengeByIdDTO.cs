using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeByIdDTO
    {
        public ChallengeDataDto? challenge { get; set; }
        public bool is_started { get; set; }
        public bool success { get; set; }
        public string? challenge_url { get; set; }
        public int? time_remaining { get; set; }
    }
}

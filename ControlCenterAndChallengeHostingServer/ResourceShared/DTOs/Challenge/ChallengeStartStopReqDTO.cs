using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeStartStopReqDTO
    {
        public int challengeId { get; set; }
        public string challengeName { get; set; } = string.Empty;
        public int teamId { get; set; }
        public int? userId { get; set; }
        public string? unixTime { get; set; }
        public string? ns { get; set; }
    }
}

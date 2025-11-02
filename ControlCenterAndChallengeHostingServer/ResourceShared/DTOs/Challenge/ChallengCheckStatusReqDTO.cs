using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengCheckStatusReqDTO
    {
        public int challengeId { get; set; }
        public string teamName { get; set; } = string.Empty;
        public string? unixTime { get; set; }
    }
}

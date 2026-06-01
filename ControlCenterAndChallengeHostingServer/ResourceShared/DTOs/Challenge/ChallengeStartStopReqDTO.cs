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
        /// <summary>
        /// Pre-generated flag value for dynamic-flag challenges. Null for static/regex flags.
        /// Injected into the K8s pod as the FLAG environment variable.
        /// </summary>
        public string? flagValue { get; set; }
    }
}

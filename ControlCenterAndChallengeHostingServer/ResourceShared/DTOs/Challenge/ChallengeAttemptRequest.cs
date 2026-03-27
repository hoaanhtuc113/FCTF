using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeAttemptRequest
    {
        public int? ChallengeId { get; set; }
        public string? Submission { get; set; }
    }
}

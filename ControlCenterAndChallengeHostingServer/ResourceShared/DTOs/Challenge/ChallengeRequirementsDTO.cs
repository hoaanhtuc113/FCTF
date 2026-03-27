using System.Collections.Generic;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeRequirementsDTO
    {
        public List<int>? prerequisites { get; set; }
        public bool? anonymize { get; set; }
    }
}

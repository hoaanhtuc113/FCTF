using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs
{

    public class StartChallengeInstanceRequest
    {
        public required int ChallengeId { get; set; }

        public required int TeamId { get; set; }

        // tinh bang phuts
        public int TimeLimit { get; set; }

        public string ImageLink { get; set; } = "{}";
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs
{
    public class CheckingStartChallengeStatusReq
    {
        public required int ChallengeId { get; set; }
        public required int TeamId { get; set; }
    }
}

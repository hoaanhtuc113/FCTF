using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeInstanceDTO
    {
        public int challenge_id { get; set; }
        public string challenge_name { get; set; }
        public string category { get; set; }
        public string status { get; set; }
        public string pod_name { get; set; }
        public bool ready { get; set; }
        public string age { get; set; }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeDeployResponeDTO
    {
        public int status { get; set; }
        public bool success { get; set; }
        public string? message { get; set; }
        public string? challenge_url { get; set; }
        public int time_limit { get; set; }
    }
}

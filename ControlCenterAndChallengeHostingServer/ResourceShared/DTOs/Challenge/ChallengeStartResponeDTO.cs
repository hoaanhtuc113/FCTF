using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeStartResponeDTO
    {
        public HttpStatusCode status { get; set; }
        public bool success { get; set; }
        public string? message { get; set; }
        public object? challenge_url { get; set; }
    }
}

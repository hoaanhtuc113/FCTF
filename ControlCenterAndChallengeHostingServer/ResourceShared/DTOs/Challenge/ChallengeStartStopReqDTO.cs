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
        public int? contestId { get; set; }

        // There is deliberately no flag field here. The dynamic flag for a
        // (challenge, team) already lives in dynamic_flag_instances by the time
        // this request is sent, so DeploymentConsumer reads it from there when
        // it builds the Argo payload. Carrying it in the body would make the
        // value something the consumer has to trust: the request travels over
        // the deployment exchange, and anything able to publish there would get
        // to choose the string that ends up inside the challenge pod - and, via
        // the workflow template, on the command line that renders its manifest.
    }
}

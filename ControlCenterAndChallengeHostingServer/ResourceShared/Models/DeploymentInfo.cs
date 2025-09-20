namespace ResourceShared.Models
{
    public class DeploymentInfo
    {
        /// <summary>
        /// ID of the Challenge.
        /// </summary>
        public required int ChallengeId { get; set; }

        /// <summary>
        /// ID of the Challenge.
        /// </summary>
        public string PodName { get; set; } = string.Empty;

        /// <summary>
        /// ID of the Team.
        /// </summary>
        public int TeamId { get; set; }

        /// <summary>
        /// ServerId of hosting machine
        /// </summary>
        public string ServerId { get; set; } = string.Empty;

        /// <summary>
        /// Deployment Port of the challenge in local machine
        /// </summary>
        public int DeploymentPort { get; set; } 

        /// <summary>
        /// Deployment Domain of the challenge
        /// </summary>
        public string DeploymentDomainName { get; set; } = string.Empty;

        /// <summary>
        /// MachineId of hosting machine
        /// </summary>
        public  DateTime? LastDeployTime { get; set; }

        public DateTime? EndTime { get; set; }

        public string Status { get; set; } // creating | done | failed

    }
    
}

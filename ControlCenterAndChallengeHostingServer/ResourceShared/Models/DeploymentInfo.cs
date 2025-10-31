namespace ResourceShared.Models
{
    public class DeploymentInfo
    {
        public required int ChallengeId { get; set; }
        public string PodName { get; set; } = string.Empty;
        public int TeamId { get; set; }
        public int DeploymentPort { get; set; } 
        public string DeploymentDomainName { get; set; } = string.Empty;
        public  DateTime? LastDeployTime { get; set; }
        public DateTime? EndTime { get; set; }
        public string? Status { get; set; }
    }
}

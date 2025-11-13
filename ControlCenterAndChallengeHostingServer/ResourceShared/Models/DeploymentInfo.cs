namespace ResourceShared.Models
{
    public class DeploymentInfo
    {
        public required int ChallengeId { get; set; }
        public string NameSpace { get; set; } = string.Empty;
        public string WorkFlowName { get; set; } = string.Empty;
        public int TeamId { get; set; }
        public int DeploymentPort { get; set; } 
        public string DeploymentDomainName { get; set; } = string.Empty;
        public long EndTime { get; set; }
        public string? Status { get; set; }
    }
}

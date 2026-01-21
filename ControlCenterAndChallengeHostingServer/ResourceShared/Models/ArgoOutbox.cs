namespace ResourceShared.Models;

public partial class ArgoOutbox
{
    public int Id { get; set; }
    public string WorkflowName { get; set; } = string.Empty;
    public string Payload { get; set; } = string.Empty;
    public int Status { get; set; } = 0;
    public DateTime Expiry { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

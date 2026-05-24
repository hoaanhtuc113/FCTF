namespace ResourceShared.Models;

public class SandboxChallenge
{
    public int Id { get; set; }
    public int? PoolId { get; set; }
    public virtual Challenge Challenge { get; set; } = null!;
}

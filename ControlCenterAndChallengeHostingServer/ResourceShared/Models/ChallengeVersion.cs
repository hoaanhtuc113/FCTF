using System;

namespace ResourceShared.Models;

public partial class ChallengeVersion
{
    public int Id { get; set; }

    public int ChallengeTemplateId { get; set; }

    public int VersionNumber { get; set; } = 1;

    public string? ImageLink { get; set; }

    public string? DeployFile { get; set; }

    public string? CpuLimit { get; set; }

    public string? CpuRequest { get; set; }

    public string? MemoryLimit { get; set; }

    public string? MemoryRequest { get; set; }

    public bool? UseGvisor { get; set; }

    public bool? HardenContainer { get; set; }

    public bool IsActive { get; set; }

    public int? CreatedBy { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public string? Notes { get; set; }

    public virtual Challenge ChallengeTemplate { get; set; } = null!;

    public virtual User? Creator { get; set; }
}

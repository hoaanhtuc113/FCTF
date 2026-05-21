using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Contest
{
    public int Id { get; set; }

    public string Name { get; set; } = null!;

    public string? Description { get; set; }

    public string Slug { get; set; } = null!;

    public string? AccessPassword { get; set; }

    public int? OwnerId { get; set; }

    public string UserMode { get; set; } = "teams";

    public string State { get; set; } = "hidden";

    public DateTime? StartTime { get; set; }

    public DateTime? EndTime { get; set; }

    public DateTime? FreezeScoreboardAt { get; set; }

    public bool ViewAfterCtf { get; set; }

    public string ChallengeVisibility { get; set; } = "private";

    public string ScoreVisibility { get; set; } = "private";

    public string AccountVisibility { get; set; } = "private";

    public string RegistrationVisibility { get; set; } = "private";

    public int? TeamSize { get; set; }

    public bool CaptainOnlyStartChallenge { get; set; } = true;

    public bool CaptainOnlySubmitChallenge { get; set; }

    public bool TeamDisbanding { get; set; } = true;

    public bool AllowNameChange { get; set; } = true;

    public int? IncorrectSubmissionsPerMin { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public virtual User? Owner { get; set; }

    public virtual ICollection<Challenge> Challenges { get; set; } = new List<Challenge>();

    public virtual ICollection<Team> Teams { get; set; } = new List<Team>();
}

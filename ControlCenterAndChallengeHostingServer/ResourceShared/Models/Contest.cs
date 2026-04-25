using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

/// <summary>
/// Một cuộc thi. Đây là đơn vị trung tâm của kiến trúc multiple-contest.
/// Table: contests
/// </summary>
public partial class Contest
{
    public int Id { get; set; }

    public string Name { get; set; } = null!;

    public string? Description { get; set; }

    /// <summary>URL-friendly identifier, unique.</summary>
    public string Slug { get; set; } = null!;

    /// <summary>FK → users.id (admin/giáo viên tạo contest)</summary>
    public int? OwnerId { get; set; }

    /// <summary>FK → semester.semester_name</summary>
    public string? SemesterName { get; set; }

    /// <summary>draft | visible | paused | ended</summary>
    public string State { get; set; } = "draft";

    /// <summary>users | teams</summary>
    public string UserMode { get; set; } = "users";

    public DateTime? StartTime { get; set; }

    public DateTime? EndTime { get; set; }

    public DateTime? FreezeScoreboardAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public virtual User? Owner { get; set; }

    public virtual Semester? Semester { get; set; }

    public virtual ICollection<ContestParticipant> Participants { get; set; } = new List<ContestParticipant>();

    public virtual ICollection<ContestsChallenge> ContestsChallenges { get; set; } = new List<ContestsChallenge>();

    public virtual ICollection<Submission> Submissions { get; set; } = new List<Submission>();

    public virtual ICollection<Solf> Solves { get; set; } = new List<Solf>();

    public virtual ICollection<Award> Awards { get; set; } = new List<Award>();

    public virtual ICollection<Unlock> Unlocks { get; set; } = new List<Unlock>();

    public virtual ICollection<Notification> Notifications { get; set; } = new List<Notification>();

    public virtual ICollection<Team> Teams { get; set; } = new List<Team>();

    public virtual ICollection<Ticket> Tickets { get; set; } = new List<Ticket>();
}

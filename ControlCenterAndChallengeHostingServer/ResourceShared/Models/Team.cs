using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Team
{
    public int Id { get; set; }

    public int? OauthId { get; set; }

    public string? Name { get; set; }

    public string? Email { get; set; }

    public string? Password { get; set; }

    public string? Secret { get; set; }

    public string? Website { get; set; }

    public string? Affiliation { get; set; }

    public string? Country { get; set; }

    public bool? Hidden { get; set; }

    public bool? Banned { get; set; }

    public DateTime? Created { get; set; }

    public int? CaptainId { get; set; }

    public int? BracketId { get; set; }

    public virtual ICollection<Achievement> Achievements { get; set; } = new List<Achievement>();

    public virtual ICollection<AwardBadge> AwardBadges { get; set; } = new List<AwardBadge>();

    public virtual ICollection<Award> Awards { get; set; } = new List<Award>();

    public virtual Bracket? Bracket { get; set; }

    public virtual User? Captain { get; set; }

    public virtual ICollection<Comment> Comments { get; set; } = new List<Comment>();

    public virtual ICollection<FieldEntry> FieldEntries { get; set; } = new List<FieldEntry>();

    public virtual ICollection<Notification> Notifications { get; set; } = new List<Notification>();

    public virtual ICollection<Solf> Solves { get; set; } = new List<Solf>();

    public virtual ICollection<Submission> Submissions { get; set; } = new List<Submission>();

    public virtual ICollection<Unlock> Unlocks { get; set; } = new List<Unlock>();

    public virtual ICollection<User> Users { get; set; } = new List<User>();
}

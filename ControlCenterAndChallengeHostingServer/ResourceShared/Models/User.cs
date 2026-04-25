using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class User
{
    public int Id { get; set; }

    public int? OauthId { get; set; }

    public string? Name { get; set; }

    public string? Password { get; set; }

    public string? Email { get; set; }

    public string? Type { get; set; }

    public string? Secret { get; set; }

    public string? Website { get; set; }

    public string? Affiliation { get; set; }

    public string? Country { get; set; }

    public bool? Hidden { get; set; } = false;

    public bool? Banned { get; set; } = false;

    public bool? Verified { get; set; }

    public DateTime? Created { get; set; }

    public string? Language { get; set; }

    public int? BracketId { get; set; }

    // --- Navigation properties ---

    public virtual Bracket? Bracket { get; set; }

    public virtual ICollection<Team> Teams { get; set; } = new List<Team>();

    // Multi-contest: các contest do user này tạo (owner)
    public virtual ICollection<Contest> OwnedContests { get; set; } = new List<Contest>();

    // Tham gia contest với role nào
    public virtual ICollection<ContestParticipant> ContestParticipations { get; set; } = new List<ContestParticipant>();

    // Challenge bank mà user này là tác giả
    public virtual ICollection<Challenge> AuthoredChallenges { get; set; } = new List<Challenge>();

    // Contest challenges do user này deploy
    public virtual ICollection<ContestsChallenge> DeployedContestChallenges { get; set; } = new List<ContestsChallenge>();

    public virtual ICollection<Achievement> Achievements { get; set; } = new List<Achievement>();

    public virtual ICollection<ActionLog> ActionLogs { get; set; } = new List<ActionLog>();

    public virtual ICollection<AwardBadge> AwardBadges { get; set; } = new List<AwardBadge>();

    public virtual ICollection<Award> Awards { get; set; } = new List<Award>();

    public virtual ICollection<Comment> CommentAuthors { get; set; } = new List<Comment>();

    public virtual ICollection<Comment> CommentUsers { get; set; } = new List<Comment>();

    public virtual ICollection<FieldEntry> FieldEntries { get; set; } = new List<FieldEntry>();

    public virtual ICollection<Notification> Notifications { get; set; } = new List<Notification>();

    public virtual ICollection<Solf> Solves { get; set; } = new List<Solf>();

    public virtual ICollection<Submission> Submissions { get; set; } = new List<Submission>();

    public virtual ICollection<Ticket> TicketAuthors { get; set; } = new List<Ticket>();

    public virtual ICollection<Ticket> TicketRepliers { get; set; } = new List<Ticket>();

    public virtual ICollection<Token> Tokens { get; set; } = new List<Token>();

    public virtual ICollection<Tracking> Trackings { get; set; } = new List<Tracking>();

    public virtual ICollection<Unlock> Unlocks { get; set; } = new List<Unlock>();
}

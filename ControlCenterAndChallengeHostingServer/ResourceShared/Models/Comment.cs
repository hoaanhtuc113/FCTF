using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Comment
{
    public int Id { get; set; }

    public string? Type { get; set; }

    public string? Content { get; set; }

    public DateTime? Date { get; set; }

    public int? AuthorId { get; set; }

    /// <summary>FK → contests.id</summary>
    public int? ContestId { get; set; }

    /// <summary>FK → contests_challenges.id (chỉ có giá trị khi Type = "challenge")</summary>
    public int? ContestChallengeId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public virtual User? Author { get; set; }

    public virtual Contest? Contest { get; set; }

    public virtual ContestsChallenge? ContestChallenge { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

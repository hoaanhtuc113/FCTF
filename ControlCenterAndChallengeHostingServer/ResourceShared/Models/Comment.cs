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

    public int? ChallengeId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public virtual User? Author { get; set; }

    public virtual Challenge? Challenge { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

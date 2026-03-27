using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Topic
{
    public int Id { get; set; }

    public string? Value { get; set; }

    public virtual ICollection<ChallengeTopic> ChallengeTopics { get; set; } = new List<ChallengeTopic>();
}

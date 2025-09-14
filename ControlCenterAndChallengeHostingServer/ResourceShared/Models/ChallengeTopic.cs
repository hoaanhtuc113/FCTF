using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class ChallengeTopic
{
    public int Id { get; set; }

    public int? ChallengeId { get; set; }

    public int? TopicId { get; set; }

    public virtual Challenge? Challenge { get; set; }

    public virtual Topic? Topic { get; set; }
}

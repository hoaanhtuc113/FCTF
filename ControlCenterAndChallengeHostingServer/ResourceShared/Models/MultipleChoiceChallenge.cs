using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class MultipleChoiceChallenge
{
    public int Id { get; set; }

    public virtual Challenge IdNavigation { get; set; } = null!;
}

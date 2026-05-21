using System;

namespace ResourceShared.Models;

public partial class ActionLog
{
    public int Id { get; set; }

    public int? UserId { get; set; }

    public DateTime Date { get; set; }

    public int Type { get; set; }

    public string Detail { get; set; } = null!;

    public string? TopicName { get; set; }

    public int? ContestId { get; set; }

    public virtual User? User { get; set; }

    public virtual Contest? Contest { get; set; }
}

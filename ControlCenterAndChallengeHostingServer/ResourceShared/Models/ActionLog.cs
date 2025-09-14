using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class ActionLog
{
    public int ActionId { get; set; }

    public int? UserId { get; set; }

    public DateTime ActionDate { get; set; }

    public int ActionType { get; set; }

    public string ActionDetail { get; set; } = null!;

    public string? TopicName { get; set; }

    public virtual User? User { get; set; }
}

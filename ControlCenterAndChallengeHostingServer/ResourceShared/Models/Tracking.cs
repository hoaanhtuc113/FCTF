using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Tracking
{
    public int Id { get; set; }

    public string? Type { get; set; }

    public string? Ip { get; set; }

    public int? UserId { get; set; }

    public DateTime? Date { get; set; }

    public virtual User? User { get; set; }
}

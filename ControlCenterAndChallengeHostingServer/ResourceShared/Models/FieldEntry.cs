using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class FieldEntry
{
    public int Id { get; set; }

    public string? Type { get; set; }

    public string? Value { get; set; }

    public int? FieldId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public virtual Field? Field { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Page
{
    public int Id { get; set; }

    public string? Title { get; set; }

    public string? Route { get; set; }

    public string? Content { get; set; }

    public bool? Draft { get; set; }

    public bool? Hidden { get; set; }

    public bool? AuthRequired { get; set; }

    public string? Format { get; set; }

    public string? LinkTarget { get; set; }

    public virtual ICollection<Comment> Comments { get; set; } = new List<Comment>();

    public virtual ICollection<File> Files { get; set; } = new List<File>();
}

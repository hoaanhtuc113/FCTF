using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Field
{
    public int Id { get; set; }

    public string? Name { get; set; }

    public string? Type { get; set; }

    public string? FieldType { get; set; }

    public string? Description { get; set; }

    public bool? Required { get; set; }

    public bool? Public { get; set; }

    public bool? Editable { get; set; }

    public virtual ICollection<FieldEntry> FieldEntries { get; set; } = new List<FieldEntry>();
}

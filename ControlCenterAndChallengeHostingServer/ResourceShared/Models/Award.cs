using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Award
{
    public int Id { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public string? Name { get; set; }

    public string? Description { get; set; }

    public DateTime? Date { get; set; }

    public int? Value { get; set; }

    public string? Category { get; set; }

    public string? Icon { get; set; }

    public string? Requirements { get; set; }

    public string? Type { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

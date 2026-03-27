using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Token
{
    public int Id { get; set; }

    public string? Type { get; set; }

    public int? UserId { get; set; }

    public DateTime? Created { get; set; }

    public DateTime? Expiration { get; set; }

    public string? Value { get; set; }

    public string? Description { get; set; }

    public virtual User? User { get; set; }
}

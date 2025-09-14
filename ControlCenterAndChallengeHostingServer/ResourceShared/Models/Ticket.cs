using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

public partial class Ticket
{
    public int Id { get; set; }

    public int? AuthorId { get; set; }

    public string? Title { get; set; }

    public string? Type { get; set; }

    public string? Description { get; set; }

    public int? ReplierId { get; set; }

    public string? ReplierMessage { get; set; }

    public string? Status { get; set; }

    public DateTime? CreateAt { get; set; }

    public virtual User? Author { get; set; }

    public virtual User? Replier { get; set; }
}

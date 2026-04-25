using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

/// <summary>
/// Kỳ học. Mỗi Contest thuộc về một Semester.
/// Table: semester
/// </summary>
public partial class Semester
{
    public int Id { get; set; }

    public string SemesterName { get; set; } = null!;

    public DateTime? StartTime { get; set; }

    public DateTime? EndTime { get; set; }

    public virtual ICollection<Contest> Contests { get; set; } = new List<Contest>();
}

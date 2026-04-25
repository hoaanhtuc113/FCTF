using System;

namespace ResourceShared.Models;

/// <summary>
/// Mở hint bằng điểm. Scoped theo contest.
/// Table: unlocks
/// Thêm: contest_id FK → contests.id
/// </summary>
public partial class Unlock
{
    public int Id { get; set; }

    /// <summary>FK → contests.id</summary>
    public int? ContestId { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    /// <summary>hint.id</summary>
    public int? Target { get; set; }

    public DateTime? Date { get; set; }

    public string? Type { get; set; }

    public virtual Contest? Contest { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

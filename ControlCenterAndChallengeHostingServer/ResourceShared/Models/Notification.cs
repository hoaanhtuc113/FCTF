using System;

namespace ResourceShared.Models;

/// <summary>
/// Thông báo trong hệ thống. Scoped theo contest.
/// Table: notifications
/// Thêm: contest_id FK → contests.id
/// </summary>
public partial class Notification
{
    public int Id { get; set; }

    /// <summary>FK → contests.id</summary>
    public int? ContestId { get; set; }

    public string? Title { get; set; }

    public string? Content { get; set; }

    public DateTime? Date { get; set; }

    public int? UserId { get; set; }

    public int? TeamId { get; set; }

    public virtual Contest? Contest { get; set; }

    public virtual Team? Team { get; set; }

    public virtual User? User { get; set; }
}

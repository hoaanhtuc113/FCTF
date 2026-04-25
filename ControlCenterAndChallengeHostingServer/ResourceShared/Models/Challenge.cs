using System;
using System.Collections.Generic;

namespace ResourceShared.Models;

/// <summary>
/// Challenge Bank — template dùng chung.
/// Giáo viên tạo challenge ở đây. Challenge này KHÔNG gắn trực tiếp với bất kỳ contest nào.
/// Khi đưa vào contest, một bản ContestsChallenge sẽ được tạo ra tham chiếu BankId = challenges.id.
///
/// Table: challenges
/// Các cột runtime (state, value, max_attempts, ...) đã chuyển sang bảng contests_challenges.
/// </summary>
public partial class Challenge
{
    public int Id { get; set; }

    public string? Name { get; set; }

    public string? Description { get; set; }

    public string? Category { get; set; }

    public string? Type { get; set; }

    public int? Difficulty { get; set; }

    public string? Requirements { get; set; }

    // --- Tác giả (đổi từ user_id → author_id) ---
    public int? AuthorId { get; set; }

    // --- Deploy config (giữ nguyên trên bank) ---
    public string? ImageLink { get; set; }

    public string? DeployFile { get; set; }

    public int? CpuLimit { get; set; }

    public int? CpuRequest { get; set; }

    public int? MemoryLimit { get; set; }

    public int? MemoryRequest { get; set; }

    public bool? UseGvisor { get; set; }

    public bool? HardenContainer { get; set; } = true;

    public int? MaxDeployCount { get; set; } = 0;

    public string ConnectionProtocol { get; set; } = "http";

    public bool SharedInstant { get; set; } = false;

    // --- Bank metadata (mới) ---
    public bool IsPublic { get; set; } = false;

    public int ImportCount { get; set; } = 0;

    public DateTime? CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public virtual User? Author { get; set; }

    // Bank children (flags, hints, files, tags, topics gắn với bank challenge)
    public virtual ICollection<Flag> Flags { get; set; } = new List<Flag>();

    public virtual ICollection<Hint> Hints { get; set; } = new List<Hint>();

    public virtual ICollection<File> Files { get; set; } = new List<File>();

    public virtual ICollection<Tag> Tags { get; set; } = new List<Tag>();

    public virtual ICollection<ChallengeTopic> ChallengeTopics { get; set; } = new List<ChallengeTopic>();

    // Polymorphic subtypes
    public virtual DynamicChallenge? DynamicChallenge { get; set; }

    public virtual MultipleChoiceChallenge? MultipleChoiceChallenge { get; set; }

    // Tất cả contest instances được tạo từ bank challenge này
    public virtual ICollection<ContestsChallenge> ContestInstances { get; set; } = new List<ContestsChallenge>();
}

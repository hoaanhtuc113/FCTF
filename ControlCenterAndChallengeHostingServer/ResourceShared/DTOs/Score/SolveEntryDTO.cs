using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Score
{
    public class SolveEntryDTO
    {
        public int? ChallengeId { get; set; }
        public int? AccountId { get; set; }
        public int? TeamId { get; set; }
        public int? UserId { get; set; }
        public int? Value { get; set; }
        public DateTime? Date { get; set; }
    }

    public class ScoreboardEntryDTO
    {
        public int Id { get; set; }
        public string AccountUrl { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int Score { get; set; }
        public int? BracketId { get; set; }
        public string? BracketName { get; set; }
        public List<SolveEntryDTO> Solves { get; set; } = new();
    }
}

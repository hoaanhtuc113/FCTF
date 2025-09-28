using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Hint
{
    public class HintResponseDTO
    {
        public int Id { get; set; }
        public string Type { get; set; } = string.Empty;
        public int? ChallengeId { get; set; }
        public int? Cost { get; set; }
        public string? Content { get; set; }
        public string? Html { get; set; }
        public string? Requirements { get; set; }
        public string View { get; set; } = "locked"; // locked | unlocked | admin
    }

    public class HintListDTO
    {
        public int Size { get; set; }
        public List<HintSummaryDTO> Hints { get; set; } = new();
    }

    public class HintSummaryDTO
    {
        public int Id { get; set; }
        public int? Cost { get; set; }
    }
}

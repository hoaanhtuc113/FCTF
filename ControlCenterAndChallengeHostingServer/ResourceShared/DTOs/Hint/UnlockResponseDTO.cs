using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Hint
{
    public class UnlockResponseDTO
    {
        public int Id { get; set; }
        public string? Type { get; set; } = string.Empty;
        public int? Target { get; set; }
        public int? TeamId { get; set; }
        public int? UserId { get; set; }
        public DateTime? Date { get; set; }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Ticket
{
    public class TicketResponseDTO
    {
        public int Id { get; set; }
        public string AuthorName { get; set; } = string.Empty;
        public string? TeamName { get; set; }
        public string Status { get; set; } = "open";
        public string Title { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public string Description { get; set; } = string.Empty;
        public string? ReplierName { get; set; }
        public string? ReplierMessage { get; set; }
    }
}

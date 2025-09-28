using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Ticket
{
    public class PaginatedTicketsDTO
    {
        public List<TicketResponseDTO> Tickets { get; set; } = new();
        public int Total { get; set; }
    }
}

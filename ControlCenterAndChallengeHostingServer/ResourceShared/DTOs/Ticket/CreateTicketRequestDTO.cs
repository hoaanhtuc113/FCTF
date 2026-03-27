using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Ticket
{
    public class CreateTicketRequestDTO
    {
        public string title { get; set; }
        public string type { get; set; }

        public string description { get; set; }

    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ResourceShared.DTOs.Ticket
{
    public class CreateTicketRequestDTO
    {
        public string title { get; set; }
        public string type { get; set; }

        public string description { get; set; }

        // Ticket currently has no challenge relation. Do not silently discard
        // unsupported fields such as challenge_id from the request.
        [JsonExtensionData]
        public Dictionary<string, JsonElement>? AdditionalFields { get; set; }

    }
}

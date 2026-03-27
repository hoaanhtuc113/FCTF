using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Team
{
    public class CreateTeamRequestDTO
    {
        public string TeamName { get; set; }
        public string TeamPassword { get; set; }
        public string Website { get; set; }
        public string Affiliation { get; set; }
        public string Country { get; set; }
        public int? BracketId { get; set; }
    }
}

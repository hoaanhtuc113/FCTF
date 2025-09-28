using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
namespace ResourceShared.DTOs.Team
{
    public class TeamResponseDTO
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Website { get; set; }
        public string? Affiliation { get; set; }
        public string? Country { get; set; }
        public int? BracketId { get; set; }
        public DateTime Created { get; set; }
    }

    public class TeamMemberDTO
    {
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public int Score { get; set; }
    }

    public class TeamScoreDTO
    {
        public string Name { get; set; } = string.Empty;
        public int? Place { get; set; }
        public List<TeamMemberDTO> Members { get; set; } = new();
        public int Score { get; set; }
        public int ChallengeTotalScore { get; set; }
    }
}

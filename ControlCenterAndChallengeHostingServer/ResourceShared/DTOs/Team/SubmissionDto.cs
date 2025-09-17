using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Team
{
    public class SubmissionDto
    {
        // Common fields
        public int Id { get; set; }
        public int? ChallengeId { get; set; }
        public ChallengeDto Challenge { get; set; }
        public UserDto User { get; set; }
        public TeamDto Team { get; set; }
        public DateTime? Date { get; set; }
        public string? Type { get; set; }

        // Admin-only fields
        public string? Provided { get; set; }
        public string? Ip { get; set; }
    }

    public class ChallengeDto
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public string Category { get; set; }
        public int? Value { get; set; }
    }

    public class UserDto
    {
        public int Id { get; set; }
        public string Name { get; set; }
    }

    public class TeamDto
    {
        public int Id { get; set; }
        public string Name { get; set; }
    }

}

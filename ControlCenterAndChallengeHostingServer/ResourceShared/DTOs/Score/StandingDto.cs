using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Score
{
    public class StandingDto
    {
        public int? AccountId { get; set; }
        public int? OauthId { get; set; }
        public string? Name { get; set; }
        public int? BracketId { get; set; }
        public string? BracketName { get; set; }
        public int? Score { get; set; }
        public int? LastId { get; set; }
        public DateTime? LastDate { get; set; }
        public bool? Hidden { get; set; }
        public bool? Banned { get; set; }
    }
}

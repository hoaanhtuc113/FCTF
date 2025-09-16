using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Auth
{
    public class AuthResponseDTO
    {
        public int id { get; set; }
        public string username { get; set; } = string.Empty;
        public string email { get; set; } = string.Empty;
        public TeamResponse? team { get; set; }

    }
    public class TeamResponse
    {
        public int id { get; set; }
        public string teamName { get; set; } = string.Empty;
    }
}

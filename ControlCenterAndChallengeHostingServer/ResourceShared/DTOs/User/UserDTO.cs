using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.User
{
    public class UserDTO
    {
        public string? Username { get; set; }
        public string? Email { get; set; }
        public string? Team { get; set; }
        public int? TeamBracketId { get; set; }
    }
}

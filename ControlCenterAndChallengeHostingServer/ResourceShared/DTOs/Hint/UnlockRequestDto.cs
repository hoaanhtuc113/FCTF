using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Hint
{
    public class UnlockRequestDto
    {
        public string Type { get; set; }
        public int Target { get; set; }
        public int? TeamId { get; set; }  // sẽ set bằng user.TeamId
        public int? UserId { get; set; }  // sẽ set bằng user.Id
    }

}

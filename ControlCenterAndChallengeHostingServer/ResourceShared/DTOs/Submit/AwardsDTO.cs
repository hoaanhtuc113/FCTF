using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Submit
{
    public class AwardsDTO
    {
        public int Id { get; set; }

        public int? AccountId { get; set; }
        public int? UserId { get; set; }

        public int? TeamId { get; set; }

        public string? Name { get; set; }
        public string? Description { get; set; }

        public DateTime? Date { get; set; }

        public int? Value { get; set; }

        public string? Category { get; set; }

        public string? Icon { get; set; }

        public string? Requirements { get; set; }

        public string? Type { get; set; }
        public virtual ResourceShared.Models.Team? Team { get; set; }

        public virtual ResourceShared.Models.User? User { get; set; }
    }
}

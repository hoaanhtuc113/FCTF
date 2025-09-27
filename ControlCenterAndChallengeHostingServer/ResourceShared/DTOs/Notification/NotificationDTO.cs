using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Notification
{
    public class NotificationDTO
    {
        public int Id { get; set; }

        public string? Title { get; set; }

        public string? Content { get; set; }

        public DateTime? Date { get; set; }

        public int? User_id { get; set; }

        public int? Team_id { get; set; }
        public ResourceShared.Models.Team? Team { get; set; }

        public  User? User { get; set; }

        public string? html { get; set; }
    }
}

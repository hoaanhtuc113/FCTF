using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.ActionLogs
{
    public class ActionLogsDTO
    {
        public int ActionId { get; set; }

        public int? UserId { get; set; }

        public DateTime ActionDate { get; set; }

        public int ActionType { get; set; }

        public string ActionDetail { get; set; } = null!;

        public string? TopicName { get; set; }

        public string? UserName { get; set; }
    }
}

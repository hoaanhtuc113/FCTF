using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Deployments
{
    public class PodInfo
    {
        public string Namespace { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int TeamId { get; set; }
        public bool Ready { get; set; }
        public string Status { get; set; } = string.Empty;
        public string Age { get; set; } = string.Empty;
    }
}

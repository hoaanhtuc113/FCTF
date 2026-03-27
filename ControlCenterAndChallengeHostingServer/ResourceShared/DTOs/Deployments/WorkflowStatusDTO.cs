using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Deployments
{
    public class WorkflowStatusDTO
    {
        public string? WorkFlowName { get; set; }
        public int? ChallengeId { get; set; }
        public string? Status { get; set; }        
        public string? Type { get; set; }          
        public string? Logs { get; set; }     
    }
}

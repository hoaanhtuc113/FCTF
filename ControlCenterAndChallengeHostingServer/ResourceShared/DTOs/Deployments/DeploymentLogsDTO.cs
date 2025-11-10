using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.Deployments
{
    public class DeploymentLogsDTO
    {
        public string WorkflowName { get; set; } = string.Empty;
        public string Logs { get; set; } = string.Empty;
    }
}

using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json.Serialization;

namespace DeploymentConsumer.Models
{
    public class ArgoWorkflowsResponse
    {
        public List<ArgoWorkflowItem>? Items { get; set; }
    }

    public class ArgoWorkflowItem
    {
        public ArgoWorkflowStatus? Status { get; set; }
    }

    public class ArgoWorkflowStatus
    {
        public string? Phase { get; set; }
    }
}

using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json.Serialization;

namespace DeploymentConsumer.Models
{
    public class ArgoWorkflowsResponse
    {
        [JsonPropertyName("items")]
        public List<object>? Items { get; set; }
    }
}

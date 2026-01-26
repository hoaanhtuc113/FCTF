using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.RabbitMQ
{
    public class DeploymentQueuePayload
    {
        public string Data { get; set; } = string.Empty;
        public DateTime Expiry { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class DequeuedMessage
    {
        public ulong DeliveryTag { get; set; }
        public DeploymentQueuePayload Payload { get; set; }
        public IDictionary<string, object>? Headers { get; set; }
    }
}

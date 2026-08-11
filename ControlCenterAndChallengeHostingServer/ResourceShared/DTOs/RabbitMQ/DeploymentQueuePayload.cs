using ResourceShared.DTOs.Challenge;
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
        public DeploymentQueuePayload Payload { get; set; } = new();

        // Deserialized and validated out of Payload.Data at the consumer boundary,
        // so the worker never parses an untrusted string in the middle of its loop
        // where a failure has no delivery tag to settle.
        public ChallengeStartStopReqDTO Request { get; set; } = new();

        // Read from the message's MessageId: the id of the HTTP request that
        // enqueued this, which is what ties the worker's log lines back to the
        // caller. Replaces a Headers dictionary that was copied off every message
        // and read by nobody - the producer never set any headers to begin with.
        public string CorrelationId { get; set; } = string.Empty;
    }
}

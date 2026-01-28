using ResourceShared.Utils;
using System.Diagnostics;

namespace DeploymentConsumer;

public sealed class RabbitMqTelemetrySource
{
    public ActivitySource Source { get; } =
        new ActivitySource(Telemetry.DeploymentConsumerRabbitMQ);
}

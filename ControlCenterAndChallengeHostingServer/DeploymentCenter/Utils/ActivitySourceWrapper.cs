using ResourceShared.Utils;
using System.Diagnostics;

namespace DeploymentCenter.Utils;

public sealed class RabbitMqTelemetrySource
{
    public ActivitySource Source { get; } =
        new ActivitySource(Telemetry.DeploymentCenterRabbitMQ);
}

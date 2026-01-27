using ResourceShared.Utils;
using System.Diagnostics;

namespace DeploymentCenter.Utils;

public sealed class HttpTelemetrySource
{
    public ActivitySource Source { get; } =
        new ActivitySource(Telemetry.DeploymentCenterHttp);
}

public sealed class RabbitMqTelemetrySource
{
    public ActivitySource Source { get; } =
        new ActivitySource(Telemetry.DeploymentCenterRabbitMQ);
}

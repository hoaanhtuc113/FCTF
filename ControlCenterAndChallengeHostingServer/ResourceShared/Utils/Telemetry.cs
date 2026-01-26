using OpenTelemetry.Context.Propagation;
using System.Text;

namespace ResourceShared.Utils;

public static class Telemetry
{
    public const string ContestantBEHttp = "contestantbe.http";
    public const string DeploymentCenterHttp = "deploymentcenter.http";
    public const string DeploymentCenterRabbitMQ = "deploymentcenter.rabbitmq";
    public const string DeploymentConsumerRabbitMQ = "deploymentconsumer.rabbitmq";
    public const string DeploymentConsumerHttp = "deploymentconsumer.http";

    public static PropagationContext ExtractTraceContext(
    IDictionary<string, object>? headers)
    {
        if (headers == null)
            return default;

        return Propagators.DefaultTextMapPropagator.Extract(
            default,
            headers,
            (h, key) =>
            {
                if (!h.TryGetValue(key, out var value))
                    return [];

                if (value is byte[] bytes)
                    return [Encoding.UTF8.GetString(bytes)];

                return [];
            });
    }

}

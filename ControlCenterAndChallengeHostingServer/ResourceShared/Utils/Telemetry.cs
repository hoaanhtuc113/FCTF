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

    public static PropagationContext Extract(IDictionary<string, object?> headers)
    {
        return Propagators.DefaultTextMapPropagator.Extract(
            default,
            headers,
            (dict, key) =>
            {
                if (!dict.TryGetValue(key, out var value)) return [];

                return value switch
                {
                    byte[] bytes => [Encoding.UTF8.GetString(bytes)],
                    string s => [s],
                    _ => []
                };
            });
    }
}

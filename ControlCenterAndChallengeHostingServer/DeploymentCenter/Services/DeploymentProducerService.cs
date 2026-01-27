using OpenTelemetry;
using OpenTelemetry.Context.Propagation;
using RabbitMQ.Client;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.RabbitMQ;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace DeploymentCenter.Services
{

    public interface IDeploymentProducerService
    {
        Task EnqueueDeploymentAsync(ChallengeStartStopReqDTO request, int expirySeconds = 300);
    }

    public class DeploymentProducerService : IDeploymentProducerService, IAsyncDisposable
    {
        private IConnection? _connection;
        private IChannel? _channel;
        private readonly ConnectionFactory _factory;
        private readonly ActivitySource _activitySource;
        private readonly SemaphoreSlim _lock = new(1, 1);

        private const string QueueName = "deployment_queue";
        private const string ExchangeName = "deployment_exchange";
        private const string RoutingKey = "deploy";

        public DeploymentProducerService(
            string host,
            string username,
            string password,
            int port,
            ActivitySource activitySource)
        {
            _factory = new ConnectionFactory
            {
                HostName = host,
                UserName = username,
                Password = password,
                Port = port,
                AutomaticRecoveryEnabled = true
            };
            _activitySource = activitySource;
        }
        private static void InjectTraceContext(Activity? activity, IBasicProperties props)
        {
            if (activity == null) return;

            props.Headers ??= new Dictionary<string, object?>();

            Propagators.DefaultTextMapPropagator.Inject(
                new PropagationContext(activity.Context, Baggage.Current),
                props.Headers,
                (headers, key, value) => headers[key] = Encoding.UTF8.GetBytes(value));
        }


        private async Task EnsureChannelAsync()
        {
            if (_connection != null && _connection.IsOpen && _channel != null && _channel.IsOpen) return;

            await _lock.WaitAsync();
            try
            {
                if (_connection == null || !_connection.IsOpen) _connection = await _factory.CreateConnectionAsync();
                if (_channel == null || !_channel.IsOpen)
                {
                    _channel = await _connection.CreateChannelAsync();
                    await _channel.ExchangeDeclareAsync(ExchangeName, ExchangeType.Direct, durable: true);
                    await _channel.QueueDeclareAsync(QueueName, durable: true, exclusive: false, autoDelete: false);
                    await _channel.QueueBindAsync(QueueName, ExchangeName, routingKey: RoutingKey);
                }
            }
            finally { _lock.Release(); }
        }

        public async Task EnqueueDeploymentAsync(ChallengeStartStopReqDTO request, int expirySeconds = 300)
        {
            await EnsureChannelAsync();

            using var activity = _activitySource.StartActivity(
                "rabbitmq.publish",
                ActivityKind.Producer);

            var payload = new DeploymentQueuePayload
            {
                Data = JsonSerializer.Serialize(request),
                CreatedAt = DateTime.UtcNow,
                Expiry = DateTime.UtcNow.AddSeconds(expirySeconds)
            };

            var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
            var properties = new BasicProperties
            {
                Persistent = true,
                Expiration = (expirySeconds * 1000).ToString(),
                ContentType = "application/json",
                MessageId = Guid.NewGuid().ToString()
            };

            InjectTraceContext(activity, properties);

            activity?.SetTag("messaging.system", "rabbitmq");
            activity?.SetTag("messaging.destination", QueueName);
            activity?.SetTag("messaging.destination_kind", "queue");
            activity?.SetTag("messaging.operation", "send");
            activity?.SetTag("messaging.message_id", properties.MessageId);

            await _channel!.BasicPublishAsync(
                ExchangeName,
                RoutingKey,
                false,
                properties,
                body);
        }

        public async ValueTask DisposeAsync()
        {
            if (_channel != null) await _channel.CloseAsync();
            if (_connection != null) await _connection.CloseAsync();
        }
    }
}
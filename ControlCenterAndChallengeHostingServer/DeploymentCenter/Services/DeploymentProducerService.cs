using RabbitMQ.Client;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.RabbitMQ;
using System.Text;
using System.Text.Json;

namespace ResourceShared.Services.RabbitMQ
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
        private readonly SemaphoreSlim _lock = new(1, 1);

        private const string QueueName = "deployment_queue";
        private const string ExchangeName = "deployment_exchange";
        private const string RoutingKey = "deploy";

        public DeploymentProducerService(string host, string username, string password, int port)
        {
            _factory = new ConnectionFactory
            {
                HostName = host,
                UserName = username,
                Password = password,
                Port = port,
                AutomaticRecoveryEnabled = true
            };
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
                Expiration = (expirySeconds * 1000).ToString()
            };

            await _channel!.BasicPublishAsync(ExchangeName, RoutingKey, false, properties, body);
        }

        public async ValueTask DisposeAsync()
        {
            if (_channel != null) await _channel.CloseAsync();
            if (_connection != null) await _connection.CloseAsync();
        }
    }
}
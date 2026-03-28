using RabbitMQ.Client;
using RabbitMQ.Client.Events;
using ResourceShared.DTOs.RabbitMQ;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace DeploymentConsumer.Services;

public interface IDeploymentConsumerService
{
    Task<List<DequeuedMessage>> DequeueAvailableBatchAsync(int count);
    Task AckAsync(ulong deliveryTag);
    Task NackAsync(ulong deliveryTag, bool requeue = false);
}

public class DeploymentConsumerService : IDeploymentConsumerService, IAsyncDisposable
{
    private IConnection? _connection;
    private IChannel? _channel;
    private string? _consumerTag;
    private readonly ConnectionFactory _factory;
    private readonly Channel<DequeuedMessage> _messageBuffer;

    private const string QueueName = "deployment_queue";

    public DeploymentConsumerService(string host, string username, string password, int port, string vhost = "/", bool useTls = false, string? sslServerName = null)
    {
        _factory = new ConnectionFactory
        {
            HostName = host,
            UserName = username,
            Password = password,
            Port = port,
            VirtualHost = string.IsNullOrWhiteSpace(vhost) ? "/" : vhost,
            AutomaticRecoveryEnabled = true,
            Ssl = new SslOption
            {
                Enabled = useTls,
                ServerName = string.IsNullOrWhiteSpace(sslServerName) ? host : sslServerName,
                Version = System.Security.Authentication.SslProtocols.Tls12,
                AcceptablePolicyErrors = System.Net.Security.SslPolicyErrors.None
            }
        };

        if (useTls)
        {
            _factory.Ssl.Enabled = true;
            _factory.Ssl.AcceptablePolicyErrors = System.Net.Security.SslPolicyErrors.RemoteCertificateChainErrors | System.Net.Security.SslPolicyErrors.RemoteCertificateNameMismatch;
        }

        _messageBuffer = Channel.CreateUnbounded<DequeuedMessage>();
    }

    private async Task EnsureConsumerAsync()
    {
        if (_connection != null && _connection.IsOpen && _channel != null && _channel.IsOpen)
            return;

        if (_connection == null || !_connection.IsOpen)
            _connection = await _factory.CreateConnectionAsync();

        if (_channel == null || !_channel.IsOpen)
        {
            _channel = await _connection.CreateChannelAsync();

            await _channel.BasicQosAsync(0, 40, false);

            var consumer = new AsyncEventingBasicConsumer(_channel);
            consumer.ReceivedAsync += OnMessageReceivedAsync;
            _consumerTag = await _channel.BasicConsumeAsync(QueueName, false, consumer);
        }
    }

    private async Task OnMessageReceivedAsync(object sender, BasicDeliverEventArgs ea)
    {
        try
        {
            var body = Encoding.UTF8.GetString(ea.Body.ToArray());
            var payload = JsonSerializer.Deserialize<DeploymentQueuePayload>(body);

            if (payload != null && payload.Expiry < DateTime.UtcNow)
            {
                await _channel!.BasicAckAsync(ea.DeliveryTag, false);
                return;
            }

            // Preserve message headers (contains tracing context) so downstream worker can extract propagation context
            await _messageBuffer.Writer.WriteAsync(new DequeuedMessage
            {
                DeliveryTag = ea.DeliveryTag,
                Payload = payload!,
                Headers = ea.BasicProperties?.Headers ?? new Dictionary<string, object?>()
            });
        }
        catch
        {
            if (_channel is { IsOpen: true })
                await _channel.BasicNackAsync(ea.DeliveryTag, false, false);
        }
    }

    public async Task<List<DequeuedMessage>> DequeueAvailableBatchAsync(int count)
    {
        await EnsureConsumerAsync();

        var batch = new List<DequeuedMessage>();
        while (batch.Count < count && _messageBuffer.Reader.TryRead(out var msg))
        {
            if (msg.Payload != null && msg.Payload.Expiry < DateTime.UtcNow)
            {
                await AckAsync(msg.DeliveryTag);
                continue;
            }
            batch.Add(msg);
        }
        return batch;
    }

    public async Task AckAsync(ulong deliveryTag)
    {
        if (_channel is { IsOpen: true })
            await _channel.BasicAckAsync(deliveryTag, false);
    }

    public async Task NackAsync(ulong deliveryTag, bool requeue = false)
    {
        if (_channel is { IsOpen: true })
            await _channel.BasicNackAsync(deliveryTag, false, requeue);
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (_consumerTag != null && _channel != null) await _channel.BasicCancelAsync(_consumerTag);
            if (_channel != null) await _channel.CloseAsync();
            if (_connection != null) await _connection.CloseAsync();
        }
        catch { }
    }
}

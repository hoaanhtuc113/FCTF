using RabbitMQ.Client;
using RabbitMQ.Client.Exceptions;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.RabbitMQ;
using System.Text;
using System.Text.Json;

namespace DeploymentCenter.Services;

public interface IDeploymentProducerService
{
    Task EnqueueDeploymentAsync(ChallengeStartStopReqDTO request, int expirySeconds = 300);
}

public sealed class DeploymentQueueFullException : Exception
{
    public DeploymentQueueFullException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}

public sealed class DeploymentRoutingFailedException : Exception
{
    public DeploymentRoutingFailedException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}

public class DeploymentProducerService : IDeploymentProducerService, IAsyncDisposable
{
    private IConnection? _connection;
    private IChannel? _channel;
    private readonly ConnectionFactory _factory;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly SemaphoreSlim _publishLock = new(1, 1);

    private const string ExchangeName = "deployment_exchange";
    private const string RoutingKey = "deploy";
    private const int PublishTimeoutMs = 5000;

    public DeploymentProducerService(
        string host,
        string username,
        string password,
        int port,
        string vhost = "/",
        bool useTls = false,
        string? sslServerName = null)
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
                AcceptablePolicyErrors = useTls ? System.Net.Security.SslPolicyErrors.None : System.Net.Security.SslPolicyErrors.RemoteCertificateNotAvailable
            }
        };

        if (useTls)
        {
            _factory.Ssl.Enabled = true;
            _factory.Ssl.AcceptablePolicyErrors = System.Net.Security.SslPolicyErrors.RemoteCertificateNameMismatch | System.Net.Security.SslPolicyErrors.RemoteCertificateChainErrors;
        }
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
                _channel = await _connection.CreateChannelAsync(new CreateChannelOptions(
                    publisherConfirmationsEnabled: true,
                    publisherConfirmationTrackingEnabled: true));
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
            Expiration = (expirySeconds * 1000).ToString(),
            ContentType = "application/json",
            MessageId = Guid.NewGuid().ToString()
        };

        await PublishOrThrowAsync(body, properties);
    }

    public async Task PublishOrThrowAsync(byte[] body, BasicProperties props)
    {
        if (_channel == null || !_channel.IsOpen)
        {
            throw new InvalidOperationException("RabbitMQ channel is not open.");
        }

        await _publishLock.WaitAsync();
        try
        {
            try
            {
                // In RabbitMQ.Client 7.x, BasicPublishAsync throws PublishException for nack/basic.return.
                await _channel.BasicPublishAsync(
                    ExchangeName,
                    RoutingKey,
                    mandatory: true,
                    props,
                    body);
            }
            catch (PublishException ex)
            {
                if (ex.IsReturn)
                {
                    throw new DeploymentRoutingFailedException("ROUTING_FAILED", ex);
                }

                throw new DeploymentQueueFullException("QUEUE_FULL", ex);
            }
        }
        finally
        {
            _publishLock.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_channel != null) await _channel.CloseAsync();
        if (_connection != null) await _connection.CloseAsync();
    }
}
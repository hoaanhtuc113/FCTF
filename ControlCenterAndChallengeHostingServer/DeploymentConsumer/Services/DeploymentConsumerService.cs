using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;
using ResourceShared.DTOs.RabbitMQ;
using System.Text;
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
    private readonly ILogger<DeploymentConsumerService> _logger;

    private const string QueueName = "deployment_queue";

    public DeploymentConsumerService(
        ILogger<DeploymentConsumerService> logger,
        string host,
        string username,
        string password,
        int port,
        string vhost = "/",
        bool useTls = false,
        string? sslServerName = null)
    {
        _logger = logger;

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
            if (!DeploymentMessageValidator.TryParseEnvelope(ea.Body.ToArray(), out var payload, out var envelopeError))
            {
                await RejectAsync(ea.DeliveryTag, envelopeError);
                return;
            }

            if (payload.Expiry < DateTime.UtcNow)
            {
                // Acked rather than dead-lettered: the request is simply too old
                // to act on, which is ordinary, and requeueing it would only have
                // it expire again. Logged because it used to pass silently, and a
                // run of these is how an overloaded deploy pipeline shows itself.
                _logger.LogInformation(
                    "Dropping deployment message {DeliveryTag}: expired at {Expiry:O}, queued at {CreatedAt:O}",
                    ea.DeliveryTag, payload.Expiry, payload.CreatedAt);

                await _channel!.BasicAckAsync(ea.DeliveryTag, false);
                return;
            }

            // Parsed and checked here rather than in the worker loop: a message
            // that cannot produce a usable request must be settled while its
            // delivery tag is still in hand, otherwise it holds a prefetch slot
            // for the lifetime of the channel.
            if (!DeploymentMessageValidator.TryParseRequest(payload.Data, out var request, out var requestError))
            {
                await RejectAsync(ea.DeliveryTag, requestError);
                return;
            }

            LogIfRedelivered(ea);

            // Preserve message headers (contains tracing context) so downstream worker can extract propagation context
            await _messageBuffer.Writer.WriteAsync(new DequeuedMessage
            {
                DeliveryTag = ea.DeliveryTag,
                Payload = payload,
                Request = request,
                Headers = ea.BasicProperties?.Headers ?? new Dictionary<string, object?>()
            });
        }
        catch (Exception ex)
        {
            await RejectAsync(ea.DeliveryTag, $"unhandled error: {ex.Message}");
        }
    }

    // A message rejected here will not parse differently on a second attempt, so
    // it is not requeued. It lands in deployment_dlq, where the body survives for
    // a week; the reason is logged here because the queue records only that the
    // message was rejected, not what this service objected to.
    private async Task RejectAsync(ulong deliveryTag, string reason)
    {
        _logger.LogWarning("Rejecting deployment message {DeliveryTag}: {Reason}", deliveryTag, reason);

        if (_channel is { IsOpen: true })
            await _channel.BasicNackAsync(deliveryTag, false, false);
    }

    // x-death is written by the broker when a message has been dead-lettered
    // before, so its presence means this message already failed somewhere and was
    // put back by hand. Worth saying out loud - it is the difference between a
    // first attempt and a replay of one that was already investigated.
    private void LogIfRedelivered(BasicDeliverEventArgs ea)
    {
        if (ea.BasicProperties?.Headers == null
            || !ea.BasicProperties.Headers.TryGetValue("x-death", out var death))
            return;

        _logger.LogWarning(
            "Deployment message {DeliveryTag} was dead-lettered before: {Death}",
            ea.DeliveryTag, DescribeDeath(death));
    }

    private static string DescribeDeath(object? death)
    {
        // x-death arrives as an array of tables, one per queue the message died
        // in, with byte-array values for the string fields.
        if (death is not IEnumerable<object?> entries)
            return "unreadable";

        var described = entries
            .OfType<IDictionary<string, object?>>()
            .Select(entry => string.Join(
                " ",
                entry.Select(field => $"{field.Key}={Stringify(field.Value)}")));

        return string.Join(" | ", described);
    }

    private static string Stringify(object? value) => value switch
    {
        byte[] bytes => Encoding.UTF8.GetString(bytes),
        null => string.Empty,
        _ => value.ToString() ?? string.Empty
    };

    public async Task<List<DequeuedMessage>> DequeueAvailableBatchAsync(int count)
    {
        await EnsureConsumerAsync();

        var batch = new List<DequeuedMessage>();
        while (batch.Count < count && _messageBuffer.Reader.TryRead(out var msg))
        {
            // Buffered messages only reach here after passing validation, so the
            // one thing left to recheck is whether the wait in the buffer outlived
            // the deploy window. Logged with the request it belonged to: this is
            // the deploy the player asked for and is not going to get.
            if (msg.Payload.Expiry < DateTime.UtcNow)
            {
                _logger.LogInformation(
                    "Dropping buffered deployment message {DeliveryTag}: expired at {Expiry:O}. ChallengeId={ChallengeId}, TeamId={TeamId}",
                    msg.DeliveryTag, msg.Payload.Expiry, msg.Request.challengeId, msg.Request.teamId);

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

using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.RabbitMQ;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DeploymentConsumer.Services;

/// <summary>
/// Checks what comes off deployment_queue before anything downstream touches it.
/// The queue is the one hop into this service that does not arrive through
/// deployment-center's HTTP boundary, so the checks that boundary performs on the
/// same DTO (ChallengeController.StartChallenge) are repeated here instead of
/// assumed: a message only proves that something was able to publish to the
/// exchange, not that deployment-center built it.
/// </summary>
internal static class DeploymentMessageValidator
{
    // The envelope carries a serialized ChallengeStartStopReqDTO and nothing
    // else, so anything appreciably larger is malformed and not worth parsing.
    public const int MaxMessageBytes = 16 * 1024;

    // Longest a queued deploy may claim to stay valid. The producer asks for
    // DEPLOYMENT_QUEUE_TIMEOUT_MINUTES (5 by default); this cap only exists so a
    // publisher cannot mint a message that outlives every reasonable window.
    private static readonly TimeSpan MaxLifetime = TimeSpan.FromHours(1);

    // Tolerance for clock drift between the producer and consumer pods.
    private static readonly TimeSpan MaxClockSkew = TimeSpan.FromMinutes(5);

    private const int MaxStringLength = 256;

    // Reject members the DTOs do not declare rather than dropping them silently,
    // so a payload shaped differently from what the producer sends is an error
    // instead of a partially understood request. MaxDepth bounds the parse of a
    // deliberately nested document.
    private static readonly JsonSerializerOptions StrictJson = new()
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 8
    };

    public static bool TryParseEnvelope(byte[] body, out DeploymentQueuePayload payload, out string error)
    {
        payload = default!;

        if (body.Length == 0)
        {
            error = "empty body";
            return false;
        }

        if (body.Length > MaxMessageBytes)
        {
            error = $"body of {body.Length} bytes exceeds the {MaxMessageBytes} byte limit";
            return false;
        }

        DeploymentQueuePayload? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<DeploymentQueuePayload>(body, StrictJson);
        }
        catch (JsonException ex)
        {
            error = $"malformed envelope: {ex.Message}";
            return false;
        }

        // A body of literal "null" deserializes to null without throwing.
        if (parsed == null)
        {
            error = "envelope is null";
            return false;
        }

        if (string.IsNullOrWhiteSpace(parsed.Data))
        {
            error = "envelope carries no data";
            return false;
        }

        var now = DateTime.UtcNow;

        if (parsed.CreatedAt > now + MaxClockSkew)
        {
            error = $"created at {parsed.CreatedAt:O}, which is in the future";
            return false;
        }

        if (parsed.Expiry <= parsed.CreatedAt)
        {
            error = $"expiry {parsed.Expiry:O} is not after creation {parsed.CreatedAt:O}";
            return false;
        }

        if (parsed.Expiry - parsed.CreatedAt > MaxLifetime)
        {
            error = $"lifetime {parsed.Expiry - parsed.CreatedAt} exceeds the {MaxLifetime} cap";
            return false;
        }

        payload = parsed;
        error = string.Empty;
        return true;
    }

    public static bool TryParseRequest(string data, out ChallengeStartStopReqDTO request, out string error)
    {
        request = default!;

        ChallengeStartStopReqDTO? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<ChallengeStartStopReqDTO>(data, StrictJson);
        }
        catch (JsonException ex)
        {
            error = $"malformed request: {ex.Message}";
            return false;
        }

        if (parsed == null)
        {
            error = "request is null";
            return false;
        }

        // Same three conditions ChallengeController.StartChallenge rejects on.
        if (parsed.challengeId <= 0)
        {
            error = $"challengeId {parsed.challengeId} is not positive";
            return false;
        }

        // Negative ids are legitimate: -2 is the shared-instance team.
        if (parsed.teamId == 0)
        {
            error = "teamId is 0";
            return false;
        }

        if (parsed.userId == null)
        {
            error = "userId is missing";
            return false;
        }

        if (parsed.challengeName.Length > MaxStringLength
            || (parsed.ns?.Length ?? 0) > MaxStringLength
            || (parsed.unixTime?.Length ?? 0) > MaxStringLength)
        {
            error = $"a request string exceeds {MaxStringLength} characters";
            return false;
        }

        request = parsed;
        error = string.Empty;
        return true;
    }
}

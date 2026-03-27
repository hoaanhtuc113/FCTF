using AspNetCoreRateLimit;
using AspNetCoreRateLimit.Redis;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;

namespace ContestantBE.RateLimiting;

public sealed class CustomRedisProcessingStrategy : RedisProcessingStrategy
{
    public CustomRedisProcessingStrategy(
        IConnectionMultiplexer connectionMultiplexer,
        IRateLimitConfiguration config,
        ILogger<RedisProcessingStrategy> logger)
        : base(connectionMultiplexer, config, logger)
    {
    }

    protected override string BuildCounterKey(
        ClientRequestIdentity requestIdentity,
        RateLimitRule rule,
        ICounterKeyBuilder counterKeyBuilder,
        RateLimitOptions rateLimitOptions)
    {
        var prefix = string.IsNullOrWhiteSpace(rateLimitOptions.RateLimitCounterPrefix)
            ? "fctf:contestant:ratelimit"
            : rateLimitOptions.RateLimitCounterPrefix.Trim();

        var ip = string.IsNullOrWhiteSpace(requestIdentity.ClientIp)
            ? "unknown"
            : requestIdentity.ClientIp;

        var endpoint = rateLimitOptions.EnableEndpointRateLimiting
            ? NormalizeSegment(rule.Endpoint)
            : "*";

        var period = NormalizeSegment(rule.Period);

        return $"{prefix}:ip:{ip}:period:{period}:ep:{endpoint}";
    }

    private static string NormalizeSegment(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "*";
        }

        return value.Trim().ToLowerInvariant().Replace(" ", string.Empty);
    }
}

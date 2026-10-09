using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ContestantBE.Utils;
using StackExchange.Redis;

namespace ContestantBE.RateLimiting;

/// <summary>Fixed-window budgets shared across replicas and challenges.</summary>
public class SensitiveRateLimitMiddleware(RequestDelegate next, ILogger<SensitiveRateLimitMiddleware> logger)
{
    public const string CounterScript = """
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
        local ttl = redis.call('TTL', KEYS[1])
        if ttl < 0 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
            ttl = tonumber(ARGV[1])
        end
        return {count, ttl}
        """;

    public async Task InvokeAsync(HttpContext context, IConnectionMultiplexer redis, UserHelper users)
    {
        if (!HttpMethods.IsPost(context.Request.Method))
        {
            await next(context);
            return;
        }
        var path = context.Request.Path.Value?.TrimEnd('/').ToLowerInvariant();
        var budgets = new List<(string Identity, int Limit, int Window)>();
        if (path == "/api/auth/login-contestant")
        {
            // Limit the body before buffering; leave it intact for MVC.
            if (context.Request.ContentLength > 8192)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                return;
            }
            context.Request.EnableBuffering();
            var position = context.Request.Body.Position;
            string? account = null;
            try
            {
                var bytes = new byte[8193];
                var size = await context.Request.Body.ReadAtLeastAsync(bytes, bytes.Length,
                    throwOnEndOfStream: false, context.RequestAborted);
                if (size > 8192)
                {
                    context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                    return;
                }
                using var body = JsonDocument.Parse(bytes.AsMemory(0, size));
                if (body.RootElement.ValueKind == JsonValueKind.Object
                    && body.RootElement.TryGetProperty("username", out var name)
                    && name.ValueKind == JsonValueKind.String)
                    account = name.GetString()?.Trim().ToLowerInvariant();
            }
            catch (JsonException)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            finally { context.Request.Body.Position = position; }
            budgets.Add(("login:ip:" + users.GetIP(context), 100, 300));
            if (!string.IsNullOrEmpty(account)) budgets.Add(("login:account:" + account, 5, 300));
        }
        else if (path is "/api/auth/change-password" or "/api/challenge/attempt")
        {
            var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (context.User.Identity?.IsAuthenticated != true || !int.TryParse(id, out var userId) || userId <= 0)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
            budgets.Add(path == "/api/challenge/attempt"
                ? ($"attempt:user:{userId}", 30, 60)
                : ($"password:user:{userId}", 5, 900));
        }
        else
        {
            await next(context);
            return;
        }

        try
        {
            var db = redis.GetDatabase();
            foreach (var budget in budgets)
            {
                var key = "fctf:contestant:security:" + Convert.ToHexString(
                    SHA256.HashData(Encoding.UTF8.GetBytes(budget.Identity))).ToLowerInvariant();
                var result = (RedisResult[])(await db.ScriptEvaluateAsync(CounterScript,
                    [key], [budget.Window]).WaitAsync(TimeSpan.FromSeconds(2), context.RequestAborted))!;
                if ((long)result[0] > budget.Limit)
                {
                    context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                    context.Response.Headers.RetryAfter = Math.Max(1, (long)result[1]).ToString();
                    await context.Response.WriteAsJsonAsync(new { success = false, message = "Too many attempts. Try again later." }, context.RequestAborted);
                    return;
                }
            }
        }
        catch (Exception ex) when (!context.RequestAborted.IsCancellationRequested)
        {
            logger.LogError(ex, "Sensitive endpoint rate limiter unavailable");
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new { success = false, message = "Temporarily unavailable. Try again later." }, context.RequestAborted);
            return;
        }
        await next(context);
    }
}

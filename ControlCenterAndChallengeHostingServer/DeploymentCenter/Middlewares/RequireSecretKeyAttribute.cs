using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using ResourceShared.Utils;
using StackExchange.Redis;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace DeploymentCenter.Middlewares;

public class RequireSecretKeyAttribute : Attribute, IAsyncResourceFilter
{
    // unixTime is part of what gets signed, but the signature alone only
    // proves "this (unixTime, data) pair was signed with PRIVATE_KEY" - it
    // says nothing about *when*. Without this window, a single captured
    // valid request (log, MITM, etc.) is replayable forever. Configurable
    // via env var since different callers may need more/less slack.
    private static readonly long MaxClockSkewSeconds =
        long.TryParse(Environment.GetEnvironmentVariable("SECRET_KEY_MAX_SKEW_SECONDS"), out var configured) && configured > 0
            ? configured
            : 60;

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var headers = context.HttpContext.Request.Headers;

        if (!headers.TryGetValue("SecretKey", out Microsoft.Extensions.Primitives.StringValues value))
        {
            context.Result = new ContentResult()
            {
                StatusCode = 400,
                Content = "[Middlewares] Invalid Secret Key"
            };
            return;
        }

        string? receivedSecretKey = value;
        if (string.IsNullOrEmpty(receivedSecretKey))
        {
            context.Result = new ContentResult()
            {
                StatusCode = 400,
                Content = "[Middlewares] Invalid Secret Key"
            };
            return;
        }

        long unixTime = 0;
        Dictionary<string, string> data;

        if (context.HttpContext.Request.HasFormContentType)
        {
            var form = context.HttpContext.Request.Form;

            // Local, not a field on the attribute: one attribute instance serves
            // every request to the action, so a field here accumulates keys from
            // earlier requests and is written from several threads at once.
            var formFields = new HashSet<string>(form.Keys);

            data = form
                .Where(kv => formFields.Contains(kv.Key) && !context.HttpContext.Request.Form.Files.Any(f => f.Name == kv.Key))
                .ToDictionary(k => k.Key, v => v.Value.ToString());

            if (form.ContainsKey("unixTime"))
            {
                unixTime = long.TryParse(form["unixTime"], out var parsedunixTime) ? parsedunixTime : DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                data.Remove("unixTime");
            }
        }
        else
        {
            // Body đã được enable buffering trong Program.cs
            using var reader = new StreamReader(context.HttpContext.Request.Body, leaveOpen: true);
            string bodyContent = await reader.ReadToEndAsync();
            context.HttpContext.Request.Body.Position = 0;


            if (string.IsNullOrWhiteSpace(bodyContent))
            {
                context.Result = new ContentResult()
                {
                    StatusCode = 400,
                    Content = $"[Middlewares] Request body is empty"
                };
                return;
            }

            var bodyData = JsonSerializer.Deserialize<Dictionary<string, object>>(bodyContent);

            if (bodyData == null)
            {
                context.Result = new ContentResult()
                {
                    StatusCode = 400,
                    Content = "[Middlewares] Invalid Json data"
                };
                return;
            }

            if (bodyData.TryGetValue("unixTime", out object? unixTimeValue))
            {
                // JsonElement cần được xử lý đúng cách
                if (unixTimeValue is JsonElement jsonElement)
                {
                    if (jsonElement.ValueKind == JsonValueKind.String)
                    {
                        _ = long.TryParse(jsonElement.GetString(), out unixTime);
                    }
                    else if (jsonElement.ValueKind == JsonValueKind.Number)
                    {
                        unixTime = jsonElement.GetInt64();
                    }
                }
                else
                {
                    _ = long.TryParse(unixTimeValue?.ToString(), out unixTime);
                }
                bodyData.Remove("unixTime");
            }

            data = bodyData.ToDictionary(k => k.Key, v => v.Value?.ToString() ?? string.Empty);
        }

        long skewSeconds = Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - unixTime);
        if (skewSeconds > MaxClockSkewSeconds)
        {
            context.Result = new ContentResult()
            {
                StatusCode = 400,
                Content = "[Middlewares] Request expired"
            };
            return;
        }

        string generatedSecretKey = SecretKeyHelper.CreateSecretKey(unixTime, data);

        // Compared in constant time: an ordinary string comparison stops at the
        // first wrong character, which tells a caller how much of a guessed
        // signature was right and turns forgery into a per-character search.
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(receivedSecretKey),
                Encoding.UTF8.GetBytes(generatedSecretKey)))
        {
            context.Result = new ContentResult()
            {
                StatusCode = 400,
                Content = "[Middlewares] Invalid Secret Key"
            };
            return;
        }

        // The time window above still leaves a replay gap for its whole
        // duration - a captured valid request works as many times as an
        // attacker can send it within MaxClockSkewSeconds. Close that with a
        // one-time-use nonce: the signature itself is unique per (unixTime,
        // data), so it doubles as the nonce. TTL only needs to outlive the
        // window above, since a stale unixTime is already rejected by then.
        bool firstUse;
        try
        {
            var redisHelper = context.HttpContext.RequestServices.GetRequiredService<RedisHelper>();
            var db = await redisHelper.GetDatabaseAsync();
            var nonceKey = $"secretkey-nonce:{receivedSecretKey}";
            firstUse = await db.StringSetAsync(nonceKey, "1", TimeSpan.FromSeconds(MaxClockSkewSeconds * 2), When.NotExists);
        }
        catch (Exception ex)
        {
            // Fail closed. Letting the request through when the nonce store is
            // unreachable would silently drop replay protection, so reject and say
            // why - an unhandled exception here surfaces as an opaque 500 instead.
            context.Result = new ContentResult()
            {
                StatusCode = 503,
                Content = $"[Middlewares] Nonce store unavailable: {ex.Message}"
            };
            return;
        }

        if (!firstUse)
        {
            context.Result = new ContentResult()
            {
                StatusCode = 400,
                Content = "[Middlewares] Secret Key already used"
            };
            return;
        }

        await next();
    }
}

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using ResourceShared.Utils;
using System.Text.Json;

namespace DeploymentCenter.Middlewares;

public class RequireSecretKeyAttribute : Attribute, IAsyncResourceFilter
{
    private readonly HashSet<string> _requiredFields = [];

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
            _requiredFields.UnionWith(form.Keys);

            data = form
                .Where(kv => _requiredFields.Contains(kv.Key) && !context.HttpContext.Request.Form.Files.Any(f => f.Name == kv.Key))
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
        string generatedSecretKey = SecretKeyHelper.CreateSecretKey(unixTime, data);

        if (receivedSecretKey != generatedSecretKey)
        {
            context.Result = new ContentResult()
            {
                StatusCode = 400,
                Content = "[Middlewares] Invalid Secret Key"
            };
            return;
        }

        await next();
    }
}

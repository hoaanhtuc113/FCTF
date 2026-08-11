using Microsoft.AspNetCore.Http;
using ResourceShared.Logger;

namespace ResourceShared.Middlewares;

/// <summary>
/// Puts a correlation id on every request: the caller's if it sent one, a new one
/// otherwise. Registered early in the pipeline so the id is already in place for
/// anything that logs, and echoed back on the response so the id a caller sees is
/// the one that appears in our logs.
/// </summary>
public class CorrelationIdMiddleware
{
    public const string HeaderName = "X-Correlation-Id";

    private readonly RequestDelegate _next;

    public CorrelationIdMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var incoming = context.Request.Headers[HeaderName].FirstOrDefault();
        var correlationId = CorrelationContext.Accept(incoming);

        CorrelationContext.Current = correlationId;
        context.Response.Headers[HeaderName] = correlationId;

        await _next(context);
    }
}

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace ContestantBE.Filters;

public sealed class GlobalExceptionFilter(ILogger<GlobalExceptionFilter> logger) : IExceptionFilter
{
    private readonly ILogger<GlobalExceptionFilter> _logger = logger;

    public void OnException(ExceptionContext context)
    {
        var exception = context.Exception;
        var statusCode = exception switch
        {
            InvalidOperationException => StatusCodes.Status400BadRequest,
            UnauthorizedAccessException => StatusCodes.Status401Unauthorized,
            KeyNotFoundException => StatusCodes.Status404NotFound,
            _ => StatusCodes.Status500InternalServerError
        };

        _logger.LogError(
            exception,
            "Unhandled exception at {Method} {Path}",
            context.HttpContext.Request.Method,
            context.HttpContext.Request.Path);

        var message = statusCode == StatusCodes.Status500InternalServerError
            ? "Internal server error"
            : exception.Message;

        context.Result = new ObjectResult(new
        {
            success = false,
            error = message
        })
        {
            StatusCode = statusCode
        };

        context.ExceptionHandled = true;
    }
}
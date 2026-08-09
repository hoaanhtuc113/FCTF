using Microsoft.Extensions.Logging;
using System;
using System.Text.Json;

namespace ResourceShared.Logger
{
    public class AppLogger
    {
        private readonly ILogger<AppLogger> _logger;
        private readonly JsonSerializerOptions _jsonOptions = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false
        };

        public AppLogger(ILogger<AppLogger> logger)
        {
            _logger = logger;
        }

        private void Write(object obj, LogLevel level = LogLevel.Information)
        {
            //_logger.LogInformation("{@log}", obj);
            var json = JsonSerializer.Serialize(obj,_jsonOptions);
            
            // if (level == LogLevel.Information)
            // {
                Console.WriteLine(json);
            // }
            // else if (level == LogLevel.Warning)
            // {
            //     Console.Out.WriteLine(json);
            // }
            // else if (level == LogLevel.Error)
            // {
            //     Console.Error.WriteLine(json);
            // }
        }

        // contestId is last on every signature so existing positional callers
        // keep compiling; pass it by name. It is emitted even when null so the
        // field is always present in the JSON, which keeps Promtail's label
        // extraction uniform across log lines.
        public void Log(string action, int? userId, int? teamId, object? data = null, LogLevel level = LogLevel.Information, string? correlationId = null, int? contestId = null)
        {
             Write(new
            {
                level = level.ToString(),
                type = "user_behavior",
                action,
                userId,
                teamId,
                contestId,
                correlationId,
                data,
                timestamp = DateTime.UtcNow.ToString("o")
            }, level: level);
        }

        public void LogDebug(string message, object? data = null, LogLevel level = LogLevel.Debug, string? correlationId = null, int? contestId = null)
        {
            Write(new
            {
                level = level.ToString(),
                type = "debug",
                message,
                contestId,
                correlationId,
                data,
                timestamp = DateTime.UtcNow.ToString("o")
            }, level: level);
        }

        public void LogError(Exception ex, int? userId = null, int? teamId = null, object? data = null, LogLevel logLevel = LogLevel.Error, string? correlationId = null, int? contestId = null)
        {
            Write(new
            {
                level = logLevel.ToString(),
                type = "error",
                exception = ex.GetType().Name,
                message = ex.Message,
                stackTrace = ex.StackTrace,
                userId,
                teamId,
                contestId,
                correlationId,
                data,
                timestamp = DateTime.UtcNow.ToString("o")
            }, level: logLevel);
        }

        // An audit entry has to answer "who did what, to whom, in which contest"
        // on its own. Reading the affected team or contest back out of the
        // before/after payload is guesswork that depends on whatever the caller
        // happened to put there, so both are structured fields here.
        public void LogAudit(string action, object? before = null, object? after = null, int? userId = null, string? correlationId = null, int? contestId = null, int? teamId = null)
        {
            Write(new
            {
                level = LogLevel.Information.ToString(),
                type = "audit",
                action,
                userId,
                teamId,
                contestId,
                correlationId,
                before,
                after,
                timestamp = DateTime.UtcNow.ToString("o")
            });
        }
    }
}

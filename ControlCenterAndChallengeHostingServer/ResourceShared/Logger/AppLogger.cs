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

        public void Log(string action, int? userId, int? teamId, object? data = null, LogLevel level = LogLevel.Information)
        {
             Write(new
            {
                level = level.ToString(),
                type = "user_behavior",
                action,
                userId,
                teamId,
                data,
                timestamp = DateTime.UtcNow.ToString("o")
            }, level: level);
        }

        public void LogDebug(string message, object? data = null, LogLevel level = LogLevel.Debug)
        {
            Write(new
            {
                level = level.ToString(),
                type = "debug",
                message,
                data,
                timestamp = DateTime.UtcNow.ToString("o")
            }, level: level);
        }

        public void LogError(Exception ex, int? userId = null, int? teamId = null, object? data = null, LogLevel logLevel = LogLevel.Error)
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
                data,
                timestamp = DateTime.UtcNow.ToString("o")
            }, level: logLevel);
        }

        public void LogAudit(string action, object? before = null, object? after = null, int? userId = null)
        {
            Write(new
            {
                level = LogLevel.Information.ToString(),
                type = "audit",
                action,
                userId,
                before,
                after,
                timestamp = DateTime.UtcNow.ToString("o")
            });
        }
    }
}

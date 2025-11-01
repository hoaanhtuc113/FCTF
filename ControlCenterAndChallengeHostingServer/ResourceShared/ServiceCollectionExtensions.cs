using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ResourceShared.Configs;
using ResourceShared.Services;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared
{
    public static class ServiceCollectionExtensions
    {
        public static IServiceCollection AddResourceShared(this IServiceCollection services)
        {
            services.AddSingleton<IConnectionMultiplexer>(sp =>
            {
                var logger = sp.GetRequiredService<ILogger<IConnectionMultiplexer>>();
                var options = ConfigurationOptions.Parse(RedisConfigs.ConnectionString);

                options.AbortOnConnectFail = false;
                options.ConnectRetry = 3;
                options.ConnectTimeout = 2000;
                options.SyncTimeout = 3000;
                options.KeepAlive = 60;
                options.ReconnectRetryPolicy = new ExponentialRetry(5000);

                var multiplexer = ConnectionMultiplexer.Connect(options);

                try
                {
                    var db = multiplexer.GetDatabase();
                    var latency = db.Ping();
                    logger.LogInformation($"[Redis] Connected OK (ping {latency.TotalMilliseconds} ms)");
                }
                catch (Exception ex)
                {
                    logger.LogWarning($"[Redis] Warm-up failed: {ex.Message}");
                    throw;
                }

                return multiplexer;
            });
            services.AddScoped<RedisHelper>();
            services.AddScoped<IK8sHealthService, K8sHealthService>();
            return services;
        }
    }
}

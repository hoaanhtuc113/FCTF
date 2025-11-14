using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
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
            services.AddSingleton<RedisLockHelper>();
            services.AddScoped<IK8sService, K8sService>();
            services.AddScoped<IArgoWorkFlowService, ArgoWorkFlowService>();
            services.AddScoped<TokenHelper>();
            var keyBytes = Encoding.UTF8.GetBytes(SharedConfig.PRIVATE_KEY);
            services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(opt =>
            {
                opt.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(keyBytes)
                };
            });

            //services.AddAuthorization();
            return services;
        }
    }
}

using k8s;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using ResourceShared.Logger;
using ResourceShared.Services;
using ResourceShared.Utils;
using StackExchange.Redis;
using System.Text;
namespace ResourceShared
{
    public static class ServiceCollectionExtensions
    {
        public static IServiceCollection AddResourceShared(this IServiceCollection services)
        {
            services.AddSingleton<IConnectionMultiplexer>(sp =>
            {
                var logger = sp.GetRequiredService<ILogger<IConnectionMultiplexer>>();
                var options = ConfigurationOptions.Parse(SharedConfig.REDIS_CONNECTION_STRING);

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

            services.AddSingleton<RedisHelper>();
            services.AddSingleton<RedisLockHelper>();
            services.AddSingleton<IKubernetes>(_ =>
            {
                KubernetesClientConfiguration config;
                try
                {
                    config = KubernetesClientConfiguration.InClusterConfig();
                }
                catch
                {
                    var kubeConfigPath =
                        Environment.GetEnvironmentVariable("KUBECONFIG")
                        ?? Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                            ".kube",
                            "config");

                    if (!File.Exists(kubeConfigPath))
                        throw new FileNotFoundException($"Không tìm thấy kubeconfig tại {kubeConfigPath}");

                    config = KubernetesClientConfiguration.BuildConfigFromConfigFile(kubeConfigPath);
                }
                return new Kubernetes(config);
            });

            services.AddSingleton<IK8sService, K8sService>();

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
            services.AddSingleton<AppLogger>();
            services.AddSingleton<MultiServiceConnector>();

            return services;
        }
    }
}


using DotNetEnv;
using DeploymentCenter.Utils;
using Microsoft.EntityFrameworkCore;
using ResourceShared;
using ResourceShared.Configs;
using ResourceShared.Models;
using StackExchange.Redis;
using DeploymentCenter.Services;

namespace DeploymentCenter
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);


            builder.Configuration.AddJsonFile("appsettings.json", optional: false, reloadOnChange: true);
            Env.Load();
            builder.Configuration.AddEnvironmentVariables();

            var connectionString = builder.Configuration["DB_CONNECTION"];


            // Add services to the container.
            builder.Services.AddDbContext<AppDbContext>(options =>
                options.UseMySql(
                    connectionString,
                    new MySqlServerVersion(new Version(10, 11, 0))
                )
            );
            builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
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
            builder.Services.AddControllers();
            builder.Services.AddScoped<IDeployService, DeployService>();
            // DI services from ResourceShared
            builder.Services.AddResourceShared();
            new DeploymentCenterConfigHelper().InitConfig();
            // Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen();

            builder.Services.AddCors(options =>
            {
                options.AddPolicy("AllowAll", p =>
                    p.AllowAnyOrigin()
                     .AllowAnyHeader()
                     .AllowAnyMethod()
                );
            });

            var app = builder.Build();
            
            // Enable buffering for all requests để có thể đọc body nhiều lần
            app.Use(async (context, next) =>
            {
                context.Request.EnableBuffering();
                await next();
            });
            
            app.UseRouting();
            app.UseCors("AllowAll");
            // Configure the HTTP request pipeline.
            if (app.Environment.IsDevelopment())
            {
                app.UseSwagger();
                app.UseSwaggerUI();
            }

            app.UseHttpsRedirection();
            app.UseAuthorization();
            app.MapControllers();
            app.Run();
        }
    }
}

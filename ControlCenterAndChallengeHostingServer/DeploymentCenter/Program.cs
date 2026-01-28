
using DeploymentCenter.Services;
using DeploymentCenter.Utils;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using OpenTelemetry.Trace;
using ResourceShared;
using ResourceShared.Middlewares;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace DeploymentCenter;

public class Program
{
    public static async Task Main(string[] args)
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
        new DeploymentCenterConfigHelper().InitConfig();
        builder.Services.AddControllers();
        builder.Services.AddResourceShared();
        builder.Services.AddScoped<IDeployService, DeployService>();

        builder.Services.AddSingleton<RabbitMqTelemetrySource>();
        builder.Services.AddOpenTelemetry()
            .WithTracing(b =>
            {
                b.AddSource(Telemetry.DeploymentCenterRabbitMQ)
                 .AddAspNetCoreInstrumentation()
                 .AddHttpClientInstrumentation()
                 .AddOtlpExporter();
            });
        // Register DeploymentConsumerService consumer
        builder.Services.AddSingleton<IDeploymentProducerService>(sp =>
        {
            // Read RabbitMQ settings from SharedConfig (can be set through .env or environment variables)
            var host = SharedConfig.RABBIT_HOST;
            var user = SharedConfig.RABBIT_USERNAME;
            var pass = SharedConfig.RABBIT_PASSWORD;
            var port = SharedConfig.RABBIT_PORT;
            var rabbitMqTelemetrySource = sp.GetRequiredService<RabbitMqTelemetrySource>();

            return new DeploymentProducerService(
                host,
                user,
                pass,
                port,
                rabbitMqTelemetrySource.Source);
        });

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
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TokenAuthenticationMiddleware>();
        app.MapControllers();
        await app.RunAsync();
    }
}

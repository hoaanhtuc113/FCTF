using DeploymentConsumer;
using DeploymentConsumer.Services;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ResourceShared;
using ResourceShared.Models;

Env.Load();
new DeploymentConsumerConfigHelper().InitConfig();

var builder = WebApplication.CreateBuilder(args);

var connectionString = Environment.GetEnvironmentVariable("DB_CONNECTION") ?? throw new Exception("DB_CONNECTION not found");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, new MySqlServerVersion(new Version(10, 11, 0)),
        mySqlOptions => mySqlOptions.EnableRetryOnFailure(5))
);

// Register ArgoWorkflowService with custom HttpClient configuration
builder.Services.AddHttpClient<IArgoWorkflowService, ArgoWorkflowService>(client =>
{
    //Timeout
    client.Timeout = TimeSpan.FromSeconds(30);
})
.ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    // remove ssl certificate validation
    ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true
});
// Register DeploymentConsumerService consumer
builder.Services.AddSingleton<IDeploymentConsumerService>(sp =>
{
    var host = DeploymentConsumerConfigHelper.RABBIT_HOST;
    var user = DeploymentConsumerConfigHelper.RABBIT_USERNAME;
    var pass = DeploymentConsumerConfigHelper.RABBIT_PASSWORD;
    var port = DeploymentConsumerConfigHelper.RABBIT_PORT;
    var vhost = DeploymentConsumerConfigHelper.RABBIT_VHOST;
    var useTls = DeploymentConsumerConfigHelper.RABBIT_TLS;

    var logger = sp.GetRequiredService<ILogger<DeploymentConsumerService>>();

    return new DeploymentConsumerService(logger, host, user, pass, port, vhost, useTls);
});

builder.Services.AddResourceShared();

builder.Services.AddSingleton<WorkerHeartbeat>();
builder.Services.AddHostedService<Worker>();

var app = builder.Build();

// Liveness endpoint for K8s: unhealthy if the worker loop hasn't ticked
// recently (stuck iteration), not just "process is running".
app.MapGet("/healthz", (WorkerHeartbeat heartbeat) =>
    heartbeat.IsHealthy(TimeSpan.FromSeconds(DeploymentConsumerConfigHelper.WORKER_POLL_INTERVAL_SECONDS * 30 + 60))
        ? Results.Ok("Healthy")
        : Results.StatusCode(503));

await app.RunAsync();
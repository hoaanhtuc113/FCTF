using DeploymentListener;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ResourceShared;
using ResourceShared.Models;
using ResourceShared.Utils;

Env.Load();
new DeploymentListenerConfigHelper().InitConfig();

var builder = WebApplication.CreateBuilder(args);

var connectionString = Environment.GetEnvironmentVariable("DB_CONNECTION")
    ?? throw new Exception("DB_CONNECTION not found");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, new MySqlServerVersion(new Version(10, 11, 0)),
        mySqlOptions => mySqlOptions.EnableRetryOnFailure(5))
);

builder.Services.AddResourceShared();
builder.Services.AddSingleton<ChallengesInformerService>();
builder.Services.AddSingleton<WorkerHeartbeat>();
builder.Services.AddHostedService<Worker>();
builder.Services.AddHostedService<ContestEndCleanupService>();

var app = builder.Build();

// Liveness endpoint for K8s: unhealthy if the pod watcher has stopped
// (StartPodWatcher returned, which is permanent - it's never restarted by
// itself) or the cleanup loop has stalled.
app.MapGet("/healthz", (WorkerHeartbeat heartbeat) =>
    heartbeat.IsHealthy(TimeSpan.FromMinutes(3))
        ? Results.Ok("Healthy")
        : Results.StatusCode(503));

await app.RunAsync();
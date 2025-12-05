using DeploymentListener;
using DeploymentListener.Services;
using DeploymentListener.Utils;
using DotNetEnv;
using MessagePack;
using Microsoft.EntityFrameworkCore;
using ResourceShared;
using ResourceShared.Models;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration.AddJsonFile("appsettings.json", optional: false, reloadOnChange: true);
Env.Load();
builder.Configuration.AddEnvironmentVariables();

var connectionString = builder.Configuration["DB_CONNECTION"];

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, new MySqlServerVersion(new Version(10, 11, 0)))
);

new DeploymentListenerConfigHelper().InitConfig();

builder.Services.AddResourceShared();
builder.Services.AddScoped<IGetPodsJob, GetPodsJob>();
builder.Services.AddHostedService<Worker>();

builder.Services.AddSignalR();

builder.Services.AddAuthorization();
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", p =>
        p.SetIsOriginAllowed(_ => true)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials()
    );
});

var app = builder.Build();

app.UseCors("AllowAll");
app.UseAuthentication();
app.UseAuthorization();

app.Run();
using DeploymentListener;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using ResourceShared;
using ResourceShared.Models;
using ResourceShared.Utils;

var builder = WebApplication.CreateBuilder(args);

Env.Load();
builder.Configuration.AddEnvironmentVariables();

var connectionString = builder.Configuration["DB_CONNECTION"];

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, new MySqlServerVersion(new Version(10, 11, 0)))
);

new SharedConfig().InitConfig();

builder.Services.AddResourceShared();
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
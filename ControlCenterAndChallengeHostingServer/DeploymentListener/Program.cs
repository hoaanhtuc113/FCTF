using DeploymentListener;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ResourceShared;
using ResourceShared.Models;
using ResourceShared.Utils;

Env.Load();
new SharedConfig().InitConfig();
var host = Host.CreateDefaultBuilder(args)
    .ConfigureServices((context, services) =>
    {
        var connectionString = Environment.GetEnvironmentVariable("DB_CONNECTION")
            ?? throw new Exception("DB_CONNECTION not found");
        services.AddDbContext<AppDbContext>(options =>
            options.UseMySql(connectionString, new MySqlServerVersion(new Version(10, 11, 0)),
                mySqlOptions => mySqlOptions.EnableRetryOnFailure(5))
        );

        services.AddResourceShared();
        services.AddSingleton<ChallengesInformerService>();
        services.AddHostedService<Worker>();
    })
    .Build();

await host.RunAsync();
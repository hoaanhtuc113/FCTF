using DeploymentConsumer;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ResourceShared;
using ResourceShared.Models;
using ResourceShared.Utils;

Env.Load();

var host = Host.CreateDefaultBuilder(args)
    .ConfigureServices((context, services) =>
    {
        // DB connection
        var connectionString = context.Configuration["DB_CONNECTION"];
        services.AddDbContext<AppDbContext>(options =>
            options.UseMySql(connectionString, new MySqlServerVersion(new Version(10, 11, 0)),
                mySqlOptions => mySqlOptions.EnableRetryOnFailure(5)) // transient error retries
        );

        services.AddResourceShared();

        // Shared config
        services.AddSingleton(sp =>
        {
            var config = new DeploymentConsumerConfigHelper();
            config.InitConfig();
            return config;
        });

        // Background worker
        services.AddHostedService<Worker>();
    })
    .Build();

// Run the worker
await host.RunAsync();

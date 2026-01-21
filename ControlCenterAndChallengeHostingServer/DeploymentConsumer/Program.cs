using DeploymentConsumer;
using DeploymentConsumer.Services;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ResourceShared;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.Net.Http.Headers;

Env.Load();
new DeploymentConsumerConfigHelper().InitConfig();
var host = Host.CreateDefaultBuilder(args)
    .ConfigureServices((context, services) =>
    {
        var connectionString = Environment.GetEnvironmentVariable("DB_CONNECTION") ?? throw new Exception("DB_CONNECTION not found");
        services.AddDbContext<AppDbContext>(options =>
            options.UseMySql(connectionString, new MySqlServerVersion(new Version(10, 11, 0)),
                mySqlOptions => mySqlOptions.EnableRetryOnFailure(5))
        );


        services.AddHttpClient<IArgoWorkflowService, ArgoWorkflowService>(client =>
        {
            //Timeout 
            client.Timeout = TimeSpan.FromSeconds(30);
        })
        .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
        {
            // remove ssl certificate validation
            ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true
        });

        services.AddResourceShared();

        services.AddHostedService<Worker>();
    })
    .Build();

await host.RunAsync();
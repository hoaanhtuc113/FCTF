using DeploymentConsumer;
using DeploymentConsumer.Services;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OpenTelemetry;
using OpenTelemetry.Context.Propagation;
using OpenTelemetry.Trace;
using ResourceShared;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.Diagnostics;

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

        // Register ArgoWorkflowService with custom HttpClient configuration
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
        // Register DeploymentConsumerService consumer
        services.AddSingleton<IDeploymentConsumerService>(sp =>
        {
            // Read RabbitMQ settings from SharedConfig (can be set through .env or environment variables)
            var host = SharedConfig.RABBIT_HOST;
            var user = SharedConfig.RABBIT_USERNAME;
            var pass = SharedConfig.RABBIT_PASSWORD;
            var port = SharedConfig.RABBIT_PORT;

            return new DeploymentConsumerService(host, user, pass, port);
        });

        services.AddResourceShared();

        services.AddSingleton<RabbitMqTelemetrySource>();
        services.AddOpenTelemetry()
            .WithTracing(b =>
            {
                b.AddSource(Telemetry.DeploymentConsumerRabbitMQ)
                 .AddHttpClientInstrumentation()
                 .AddOtlpExporter();
            });        

        services.AddHostedService<Worker>();
    })
    .Build();

Sdk.SetDefaultTextMapPropagator(
    new CompositeTextMapPropagator(
    [
        new TraceContextPropagator(),
        new BaggagePropagator()
    ]));


await host.RunAsync();
using MassTransit;
using Microsoft.Extensions.Options;
using MQ_Consumer.Utils;
using ResourceShared.Configs;
using StackExchange.Redis;

namespace MQ_Consumer
{
    public class Program
    {
        public class RabbitMqOptions
        {
            public string Host { get; set; }
            public string VirtualHost { get; set; } = "/";
            public string Username { get; set; }
            public string Password { get; set; }
            public int Port { get; set; }
        }

        public static async Task Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            new ConsumerConfig().InitConfig();
            // Logging
            builder.Logging.ClearProviders();
            builder.Logging.AddConsole();

            // Config RabbitMQ
            builder.Services.Configure<RabbitMqOptions>(
                builder.Configuration.GetSection("RabbitMQ")
            );
            builder.Services.AddHttpClient();
            // Config Redis
            builder.Services.AddSingleton<IConnectionMultiplexer>(ConnectionMultiplexer.Connect(RedisConfigs.ConnectionString));
            builder.Services.AddMassTransit(conf =>
            {
                conf.AddConsumer<StartChallengeConsumer>();

                conf.UsingRabbitMq((context, cfg) =>
                {
                    var opt = context
                        .GetRequiredService<IOptions<RabbitMqOptions>>()
                        .Value;
                    var uri = new Uri($"rabbitmq://{opt.Host}:{opt.Port}{opt.VirtualHost}");

                    cfg.Host(uri, h =>
                    {
                        h.Username(opt.Username);
                        h.Password(opt.Password);
                    });

                    cfg.ReceiveEndpoint("start-challenge-queue", e =>
                    {
                        e.ConfigureConsumer<StartChallengeConsumer>(context);
                    });

                    // Auto-configure endpoint
                    cfg.ConfigureEndpoints(context);
                });
            });

            var app = builder.Build();
            await Console.Out.WriteLineAsync("MQ Consumer starting...");

            await app.RunAsync($"{ServiceConfigs.ServerHost}:{ServiceConfigs.ServerPort}");
        }
    }
}

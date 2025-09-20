using MassTransit;
using Microsoft.Extensions.Options;
using MQ_Consumer.Utils;
using RabbitMQ.Client;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.Models;
using StackExchange.Redis;

namespace MQ_Consumer
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            new ConsumerConfig().InitConfig();
            builder.Services.Configure<RabbitMqOptions>(builder.Configuration.GetSection("RabbitMQ"));
            builder.Services.AddHttpClient();
            Console.WriteLine("RedisConfigs.ConnectionString: "+RedisConfigs.ConnectionString);
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
                        e.Bind("start-challenge-exchange", x =>
                        {
                            x.ExchangeType = ExchangeType.Fanout;
                        });
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


using MassTransit;
using Microsoft.Extensions.Options;
using MQ_Producer.Services;
using MQ_Producer.Utils;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.Models;

namespace MQ_Producer
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            builder.Services.Configure<RabbitMqOptions>(builder.Configuration.GetSection("RabbitMQ"));
            // Add services to the container.
            builder.Services.AddScoped<IPublisherService<StartChallengeInstanceRequest>, StartChallengePublisherService>();

            builder.Services.AddMassTransit(conf =>
            {
                conf.UsingRabbitMq((context, cfg) =>
                {
                    var opt = context.GetRequiredService<IOptions<RabbitMqOptions>>().Value;

                    cfg.Host(new Uri($"rabbitmq://{opt.Host}:{opt.Port}{opt.VirtualHost}"), h =>
                    {
                        h.Username(opt.Username);
                        h.Password(opt.Password);
                    });
                    cfg.Message<StartChallengeInstanceRequest>(m => m.SetEntityName("start-challenge-exchange"));
                });
            });

            builder.Services.AddControllers();
            // Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen();

            new MQProducerConfigHelper().InitConfig();
            var app = builder.Build();

            // Configure the HTTP request pipeline.
            if (app.Environment.IsDevelopment())
            {
                app.UseSwagger();
                app.UseSwaggerUI();
            }

            //app.UseHttpsRedirection();

            app.UseAuthorization();


            app.MapControllers();

            app.Run($"{ServiceConfigs.ServerHost}:{ServiceConfigs.ServerPort}");
        }
    }
}

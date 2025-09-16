
using ControlCenterServer.Configs;
using ResourceShared.Configs;
using ResourceShared.Utils;
using StackExchange.Redis;

namespace ControlCenterServer
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // Add services to the container.
            await Console.Out.WriteLineAsync("Start Config server....");

            builder.Services.AddControllers();
            // Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen();
            builder.Services.AddCors(options =>
            {
                options.AddPolicy("AllowAll", policy =>
                {
                    policy.AllowAnyOrigin()
                        .AllowAnyHeader()
                        .AllowAnyMethod();
                });
            });
            builder.Services.AddSingleton<ConfigHelper>();
            //Init config from ControlConfig, SharedConfig
            new ControlCenterConfigHelper().InitConfig();

            Console.WriteLine("RedisConfigs.ConnectionString: "+RedisConfigs.ConnectionString);
            // Cấu hình Redis
            builder.Services.AddSingleton<IConnectionMultiplexer>(ConnectionMultiplexer.Connect(RedisConfigs.ConnectionString));

            //RedisHelper redisHelper = new RedisHelper(builder.Services.BuildServiceProvider().GetRequiredService<IConnectionMultiplexer>());

            await Console.Out.WriteLineAsync("Config server done, run application....");

            var app = builder.Build();
            app.UseCors("AllowAll"); 
            // Configure the HTTP request pipeline.

            app.UseSwagger();
            app.UseSwaggerUI();
            

            app.UseAuthorization();

            app.MapControllers();

            app.Run($"{ServiceConfigs.ServerHost}:{ServiceConfigs.ServerPort}");
            //app.Run();
        }
    }
}

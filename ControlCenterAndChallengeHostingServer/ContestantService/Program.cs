
using ContestantService.Utils;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Configs;
using ResourceShared.Models;
using ContestantService.Extensions;
using ResourceShared.Utils;
namespace ContestantService
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            var connectionString = builder.Configuration.GetConnectionString("DbConnection");
            // Add services to the container.
            builder.Services.AddDbContext<AppDbContext>(options => options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString)));

            builder.Services.AddControllers();
            // Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen();
            builder.Services.AddMemoryCache();
            builder.Services.AddSingleton<ConfigHelper>();
            builder.Services.AddSingleton<CtfTimeHelper>();
            //Init config from ControlConfig, SharedConfig
            new ContestantServiceConfigHelper().InitConfig();

            await Console.Out.WriteLineAsync("Config server done, run application....");
            var app = builder.Build();


                app.UseSwagger();
                app.UseSwaggerUI();


            //app.UseHttpsRedirection();

            app.UseAuthorization();
            app.UseTokenAuthentication();

            app.MapControllers();

            app.Run($"{ServiceConfigs.ServerHost}:{ServiceConfigs.ServerPort}");
        }
    }
}

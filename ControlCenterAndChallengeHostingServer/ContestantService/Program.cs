
using ContestantService.Utils;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Configs;
using ResourceShared.Models;

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

            //Init config from ControlConfig, SharedConfig
            new ContestantServiceConfigHelper().InitConfig();

            await Console.Out.WriteLineAsync("Config server done, run application....");
            var app = builder.Build();

            // Configure the HTTP request pipeline.
            if (app.Environment.IsDevelopment())
            {
                app.UseSwagger();
                app.UseSwaggerUI();
            }

            app.UseHttpsRedirection();

            app.UseAuthorization();


            app.MapControllers();

            app.Run($"{ServiceConfigs.ServerHost}:{ServiceConfigs.ServerPort}");
        }
    }
}

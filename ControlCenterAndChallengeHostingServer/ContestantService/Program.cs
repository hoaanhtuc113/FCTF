using System;
using ContestantService.Extensions;
using ContestantService.Interfaces;
using ContestantService.Services;
using ContestantService.Utils;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models; 
using ResourceShared.Configs;
using ResourceShared.Models;
using ResourceShared.Utils;
using StackExchange.Redis;

namespace ContestantService
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            builder.Configuration
                .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
                .AddEnvironmentVariables();
            var configuration = builder.Configuration;
            var connectionString = configuration.GetConnectionString("DbConnection");

            // Add services to the container.
            builder.Services.AddDbContext<AppDbContext>(options => options.UseMySql(
                connectionString,
                new MySqlServerVersion(new Version(10, 11, 0)) 
            ));
            builder.Services.AddSingleton<IConnectionMultiplexer>(sp =>
            {
                var options = ConfigurationOptions.Parse(RedisConfigs.ConnectionString);
                options.AbortOnConnectFail = false;
                options.ConnectTimeout = 10000;
                options.SyncTimeout = 10000;
                return ConnectionMultiplexer.Connect(options);
            });
            builder.Services.AddControllers();
            builder.Services.AddHttpClient();
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen(c =>
            {
                c.SwaggerDoc("v1", new OpenApiInfo
                {
                    Title = "ContestantService API",
                    Version = "v1"
                });
                c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
                {
                    Name = "Authorization",
                    Type = SecuritySchemeType.Http,
                    Scheme = "Bearer",
                    BearerFormat = "JWT",
                    In = ParameterLocation.Header,
                    Description = "Nhập JWT token vào ô bên dưới. \r\n\r\nVí dụ: \"Bearer {token}\""
                });
                c.AddSecurityRequirement(new OpenApiSecurityRequirement
                {
                    {
                        new OpenApiSecurityScheme
                        {
                            Reference = new OpenApiReference
                            {
                                Type = ReferenceType.SecurityScheme,
                                Id = "Bearer"
                            }
                        },
                        Array.Empty<string>()
                    }
                });
            });
            builder.Services.Configure<ProxyOptions>(configuration.GetSection("Proxy"));
            builder.Services.AddScoped<IAuthService, AuthService>();
            builder.Services.AddScoped<IHintService, HintService>();
            builder.Services.AddScoped<ITeamService, TeamService>();
            builder.Services.AddScoped<IScoreboardService, ScoreboardService>();
            builder.Services.AddScoped<ITicketService, TicketService>();
            builder.Services.AddScoped<IConfigService, ConfigService>();
            builder.Services.AddMemoryCache();
            builder.Services.AddSingleton<ConfigHelper>();
            builder.Services.AddSingleton<CtfTimeHelper>();
            builder.Services.AddSingleton<ScoreHelper>();
            builder.Services.AddSingleton<UserHelper>();
          
            builder.Services.AddScoped<IChallengeServices, ChallengeServices>();
            builder.Services.AddScoped<IFileService, FileService>();
            builder.Services.AddScoped<INotificationServices, NotificationServices>();
            builder.Services.AddScoped<IUserServices, UserServices>();
            builder.Services.AddScoped<IActionLogsServices, ActionLogsServices>();
            //Init config from ControlConfig, SharedConfig
            new ContestantServiceConfigHelper().InitConfig();
            ServiceConfigs.SecretKey = configuration["ServiceConfigs:SecretKey"] ?? throw new Exception("Can't read ServiceConfigs:SecretKey");

            builder.Services.AddCors(options =>
            {
                options.AddPolicy("AllowAll", p =>
                    p.AllowAnyOrigin()
                     .AllowAnyHeader()
                     .AllowAnyMethod()
                );
            });
            builder.Services.AddOutputCache();


            await Console.Out.WriteLineAsync("Config server done, run application....");
            var app = builder.Build();
            app.UseRouting();
            app.UseCors("AllowAll");
            app.UseSwagger();
            app.UseSwaggerUI();
            app.UseOutputCache();
            // app.UseHttpsRedirection();
            app.UseAuthorization();
            app.UseTokenAuthentication(); 
            app.MapControllers();
            //app.Run($"{ServiceConfigs.ServerHost}:{ServiceConfigs.ServerPort}");
            app.Run();
        }
    }
}

using ContestantService.Extensions;
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
            var connectionString = builder.Configuration.GetConnectionString("DbConnection");
            IConfiguration configuration = new ConfigurationBuilder()
                .AddJsonFile("appsettings.json", optional: true, reloadOnChange: true)
                .Build();

            // Add services to the container.
            builder.Services.AddDbContext<AppDbContext>(options =>
                options.UseMySql(connectionString, ServerVersion.AutoDetect(connectionString)));
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
            builder.Services.Configure<ProxyOptions>(builder.Configuration.GetSection("Proxy"));

            builder.Services.AddMemoryCache();
            builder.Services.AddSingleton<ConfigHelper>();
            builder.Services.AddSingleton<CtfTimeHelper>();
            builder.Services.AddScoped<ScoreHelper>(provider =>
            {
                var options = provider.GetRequiredService<DbContextOptions<AppDbContext>>();
                var config = provider.GetRequiredService<ConfigHelper>();
                return new ScoreHelper(options, config);
            });
            builder.Services.AddSingleton<UserHelper>();
            builder.Services.AddSingleton<IConnectionMultiplexer>(ConnectionMultiplexer.Connect(RedisConfigs.ConnectionString));
            builder.Services.AddScoped<IChallengeServices, ChallengeServices>();
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



            await Console.Out.WriteLineAsync("Config server done, run application....");
            var app = builder.Build();

            app.UseSwagger();
            app.UseSwaggerUI();

            app.UseHttpsRedirection();
            app.UseCors("AllowAll");
            app.UseAuthorization();
            app.UseTokenAuthentication(); 

            app.MapControllers();

            app.Run($"{ServiceConfigs.ServerHost}:{ServiceConfigs.ServerPort}");
        }
    }
}

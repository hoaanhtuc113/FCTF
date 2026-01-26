using ContestantBE.Interfaces;
using ContestantBE.Services;
using ContestantBE.Utils;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using ResourceShared;
using ResourceShared.Middlewares;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.Diagnostics;

namespace ContestantBE
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);
            builder.Configuration.AddJsonFile("appsettings.json", optional: false, reloadOnChange: true);
            Env.Load();
            builder.Configuration.AddEnvironmentVariables();
            var connectionString = builder.Configuration["DB_CONNECTION"];

            // Add services to the container.
            builder.Services.AddDbContext<AppDbContext>(options => options.UseMySql(
                connectionString,
                new MySqlServerVersion(new Version(10, 11, 0))
            ));

            builder.Services.AddControllers();
            builder.Services.AddHttpClient();
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen(c =>
            {
                c.SwaggerDoc("v1", new OpenApiInfo
                {
                    Title = "ContestantBE API",
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
            builder.Services.AddScoped<IAuthService, AuthService>();
            builder.Services.AddScoped<IHintService, HintService>();
            builder.Services.AddScoped<ITeamService, TeamService>();
            builder.Services.AddScoped<IScoreboardService, ScoreboardService>();
            builder.Services.AddScoped<ITicketService, TicketService>();
            builder.Services.AddScoped<IConfigService, ConfigService>();
            builder.Services.AddMemoryCache();
            builder.Services.AddScoped<ConfigHelper>();
            builder.Services.AddScoped<CtfTimeHelper>();
            builder.Services.AddScoped<ScoreHelper>();
            builder.Services.AddScoped<UserHelper>();
            builder.Services.AddHttpContextAccessor();

            builder.Services.AddScoped<IChallengeServices, ChallengeServices>();
            builder.Services.AddScoped<IFileService, FileService>();
            builder.Services.AddScoped<INotificationServices, NotificationServices>();
            builder.Services.AddScoped<IUserServices, UserServices>();
            builder.Services.AddScoped<IActionLogsServices, ActionLogsServices>();
            //Init config from ControlConfig, SharedConfig
            new ContestantBEConfigHelper().InitConfig();
            // DI services from ResourceShared
            builder.Services.AddResourceShared();

            builder.Services.AddSingleton(_ => new ActivitySource(Telemetry.ContestantBEHttp));
            builder.Services.AddOpenTelemetry()
                .WithTracing(b =>
                {
                    b.AddSource(Telemetry.ContestantBEHttp)
                     .AddAspNetCoreInstrumentation()
                     .AddOtlpExporter();
                });
            builder.Services.AddSingleton(sp =>
            {
                var activitySource = sp.GetRequiredService<ActivitySource>();
                return new MultiServiceConnector(activitySource);
            });

            builder.Logging.ClearProviders();
            builder.Logging.AddJsonConsole();

            builder.Services.AddCors(options =>
            {
                options.AddPolicy("AllowAll", p =>
                    p.AllowAnyOrigin()
                     .AllowAnyHeader()
                     .AllowAnyMethod()
                );
            });
            builder.Services.AddOutputCache();

            builder.Services.AddOpenTelemetry()
                .WithTracing(t =>
                    {
                        t.SetResourceBuilder(
                             ResourceBuilder.CreateDefault()
                               .AddService("contestant-be"))
                         .AddAspNetCoreInstrumentation()
                         .AddHttpClientInstrumentation()
                         .AddOtlpExporter();
                    });

            var app = builder.Build();
            app.UseRouting();
            app.UseCors("AllowAll");
            app.UseOutputCache();
            app.UseAuthentication();
            app.UseAuthorization();
            app.UseMiddleware<TokenAuthenticationMiddleware>();
            app.MapControllers();

            await Console.Out.WriteLineAsync("Config server done, run application....");
            app.Run();
        }
    }
}

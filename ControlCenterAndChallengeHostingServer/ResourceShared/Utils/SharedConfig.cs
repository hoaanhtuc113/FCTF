using DotNetEnv;
using Microsoft.Extensions.Configuration;

namespace ResourceShared.Utils;

public class SharedConfig
{
    /// <summary>
    /// Hàm đọc các config từ appsettings.json và .env file
    /// </summary>
    /// <exception cref="Exception">Exception sẽ được throw khi có vấn đề với file appsetting (Thiếu config, không đúng kiểu dữ liệu,...)</exception>
    public static string PRIVATE_KEY = "";
    public static string TCP_DOMAIN = "";
    public static string START_CHALLENGE_TEMPLATE = "";

    public static string REDIS_CONNECTION_STRING = "";

    public static IConfiguration configuration = BuildConfiguration();

    private static IConfiguration BuildConfiguration()
    {
        // Load .env file từ thư mục gốc của project đang chạy
        var envFilePath = Path.Combine(Directory.GetCurrentDirectory(), ".env");
        if (System.IO.File.Exists(envFilePath))
        {
            Env.Load(envFilePath);
        }

        return new ConfigurationBuilder()
            .AddJsonFile("appsettings.json", optional: true, reloadOnChange: true)
            .AddEnvironmentVariables()
            .Build();
    }
    public virtual void InitConfig()
    {
        REDIS_CONNECTION_STRING =
            configuration["Redis:ConnectionString"]
            ?? configuration["REDIS_CONNECTION"]
            ?? throw new Exception("Can't read Redis connection string (Redis:ConnectionString or REDIS_CONNECTION)");
        PRIVATE_KEY = configuration["PRIVATE_KEY"] ?? throw new Exception("Can't read PrivateKey");
        TCP_DOMAIN = configuration["TCP_DOMAIN"] ?? throw new Exception("Can't read TCP_DOMAIN");
        START_CHALLENGE_TEMPLATE = configuration["START_CHALLENGE_TEMPLATE"] ?? throw new Exception("Can't read START_CHALLENGE_TEMPLATE");

    }
}

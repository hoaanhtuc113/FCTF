using Microsoft.Extensions.Configuration;
using ResourceShared.Configs;
using ResourceShared.Models;
using DotNetEnv;

namespace ResourceShared.Utils
{
    public class SharedConfig
    {
        /// <summary>
        /// Hàm đọc các config từ appsettings.json và .env file
        /// </summary>
        /// <exception cref="Exception">Exception sẽ được throw khi có vấn đề với file appsetting (Thiếu config, không đúng kiểu dữ liệu,...)</exception>
        public static string PRIVATE_KEY = "";
        public static string TCP_DOMAIN = "";
        public static string START_CHALLENGE_TEMPLATE = "";

        // RabbitMQ configuration (can be overridden by environment variables or .env)
        public static string RABBIT_HOST = "";
        public static string RABBIT_USERNAME = "";
        public static string RABBIT_PASSWORD = "";
        public static int RABBIT_PORT = 5672;

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
            RedisConfigs.ConnectionString = configuration["REDIS_CONNECTION"] ?? throw new Exception("Can't read RedisConnectionString");
            PRIVATE_KEY = configuration["PRIVATE_KEY"] ?? throw new Exception("Can't read PrivateKey");
            TCP_DOMAIN = configuration["TCP_DOMAIN"] ?? throw new Exception("Can't read TCP_DOMAIN");
            START_CHALLENGE_TEMPLATE = configuration["START_CHALLENGE_TEMPLATE"] ?? throw new Exception("Can't read START_CHALLENGE_TEMPLATE");

            // Read RabbitMQ settings (use sensible defaults when env vars are missing)
            RABBIT_HOST = configuration["RABBIT_HOST"] ?? "localhost";
            RABBIT_USERNAME = configuration["RABBIT_USERNAME"] ?? "guest";
            RABBIT_PASSWORD = configuration["RABBIT_PASSWORD"] ?? "guest";
            RABBIT_PORT = int.TryParse(configuration["RABBIT_PORT"], out var p) ? p : 5672;
        }
    }
}

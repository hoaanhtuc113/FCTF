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
        }
    }
}

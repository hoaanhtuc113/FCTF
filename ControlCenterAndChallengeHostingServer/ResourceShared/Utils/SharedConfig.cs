using Microsoft.Extensions.Configuration;
using ResourceShared.Configs;
using ResourceShared.Models;

namespace ResourceShared.Utils
{
    public class SharedConfig
    {
        /// <summary>
        /// Hàm đọc các config từ appsettings.json
        /// </summary>
        /// <exception cref="Exception">Exception sẽ được throw khi có vấn đề với file appsetting (Thiếu config, không đúng kiểu dữ liệu,...)</exception>

        public static IConfiguration configuration = new ConfigurationBuilder()
                .AddJsonFile("appsettings.json", optional: true, reloadOnChange: true)
                .Build();
        public virtual void InitConfig()
        {
            RedisConfigs.ConnectionString = configuration.GetConnectionString("RedisConnection") ?? throw new Exception("Can't read RedisConnectionString");
            ServiceConfigs.PrivateKey = configuration["ServiceConfigs:PrivateKey"] ?? throw new Exception("Can't read ServiceConfigs:PrivateKey");
            ServiceConfigs.ServerHost = configuration["ServiceConfigs:ServerHost"] ?? throw new Exception("Can't read ServiceConfigs:ServerHost");
            ServiceConfigs.ServerPort = configuration["ServiceConfigs:ServerPort"] ?? throw new Exception("Can't read ServiceConfigs:ServerPort");
            ServiceConfigs.DomainName = configuration["ServiceConfigs:DomainName"] ?? throw new Exception("Can't read ServiceConfigs:DomainName");
            EnvironmentConfigs.ENVIRONMENT_NAME= configuration["EnvironmentConfigs:ENVIRONMENT_NAME"] ?? throw new Exception("Can't read EnvironmentConfigs:ENVIRONMENT_NAME");
        }
    }
}

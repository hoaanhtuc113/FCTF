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
            ServiceConfigs.PrivateKey = configuration["PRIVATE_KEY"] ?? throw new Exception("Can't read ServiceConfigs:PrivateKey");
            K8sConfigs.USE_LOCAL_K8S = Environment.GetEnvironmentVariable("USE_LOCAL_K8S") ?? "false";
            K8sConfigs.KUBE_CONFIG_PATH = Environment.GetEnvironmentVariable("KUBE_CONFIG_PATH") ?? "";
            EnvironmentConfigs.ENVIRONMENT_NAME= configuration["ENVIRONMENT_NAME"] ?? throw new Exception("Can't read EnvironmentConfigs:ENVIRONMENT_NAME");
            Console.WriteLine($"[SharedConfig] Kubeconfig {K8sConfigs.USE_LOCAL_K8S} {K8sConfigs.KUBE_CONFIG_PATH}");
        }
    }
}

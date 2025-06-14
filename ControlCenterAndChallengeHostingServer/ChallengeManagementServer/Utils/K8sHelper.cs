using ResourceShared.Configs;
using ResourceShared.Models;
using System.Text;
using YamlDotNet.Serialization.NamingConventions;
using YamlDotNet.Serialization;
using System.Text.RegularExpressions;
using YamlDotNet.Core;
using ResourceShared.Utils;
using ChallengeManagementServer.Configs;
using System.Diagnostics;
using System.Net.Sockets;
using System.Net;
using Newtonsoft.Json;
using System.Net.NetworkInformation;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using Newtonsoft.Json.Linq;

namespace ChallengeManagementServer.Utils
{
    public class K8sHelper
    {
        public K8sHelper(int challengeId, IConnectionMultiplexer connectionMultiplexer)
        {
            ChallengeId = challengeId;
            string BasePath = ChallengeManagePathConfigs.ChallengeBasePath;

            // Directory with challenge folder and challenge.yaml file
            ProjectPath = Path.Combine(BasePath, $"{ChallengeManagePathConfigs.ChallengeRootName}-{ChallengeId}");

            //Yaml file path
            YamlPath = Path.Combine(ProjectPath, "challenge.yaml");

            //Challenge directory path
            ChallengeDirectoryPath = Path.Combine(ProjectPath, "challenge");

            YamlContent = File.ReadAllText(YamlPath);

            //Parse yaml file to c# class
            IDeserializer deserializer = new DeserializerBuilder()
            .WithNamingConvention(CamelCaseNamingConvention.Instance) // Chuyển đổi giữa snake_case và camelCase
            .Build();
            DeploymentConfigs = deserializer.Deserialize<K8sDeploymentDefinition>(YamlContent);
            _connectionMultiplexer = connectionMultiplexer;
        }

        private int ChallengeId = 0;
        private string ProjectPath = "";
        private string YamlPath = "";
        private string ChallengeDirectoryPath = "";
        private string YamlContent = "";
        public K8sDeploymentDefinition DeploymentConfigs;
        IConnectionMultiplexer _connectionMultiplexer;
        private readonly object _portLock = new object();

        /// <summary>
        /// This function will be build images and update image link to yaml file. If build failed, function will throw exception with build logs
        /// </summary>
        /// <returns>Return dictionary with key is service name, value is image link</returns>
        /// <exception cref="Exception"></exception>
        public async Task<Dictionary<string, string>> BuildImagesAndUpdateYamlAsync()
        {
            await RemoveImageFromDiskAsync();
            bool IsHaveException = false;
            Dictionary<string, string> ImageLinks = new();
            List<string> ExceptionMessages = new List<string>();
            //Foreach container and deploy each other, then add image link to its (Multi threatasking)
            List<Task> TaskList = new List<Task>();
            foreach (var container in DeploymentConfigs.Spec.Template.Spec.Containers)
            {
                await Task.Delay(500);
                TaskList.Add(Task.Run(async () =>
                {
                    await Console.Out.WriteLineAsync("Start build image...");
                    //Get target service and build iamge for it
                    string BuildOutput = await CmdHelper.ExecuteBashCommandAsync(ProjectPath, $"kctf chal build challenge/{container.Name}", true);

                    await Console.Out.WriteLineAsync("Received Build Output: " + BuildOutput);

                    var ImageLink = Regex.Match(BuildOutput, "(?<=__FCTF-IMAGE-URL__).*?(?=__FCTF-IMAGE-URL__)").Value.Trim();

                    //If image link not found, then add exception message to return build logs
                    if (string.IsNullOrEmpty(ImageLink))
                    {
                        IsHaveException = true;
                        string ExceptionMessage = $"<p style=\"color:green\">================================ BEGIN BUILD OUTPUT ================================</p>{Environment.NewLine}{Environment.NewLine}";
                        ExceptionMessage += $"<p>Service: {container.Name}</p>";
                        ExceptionMessage += $"{Environment.NewLine}{string.Join("\n", BuildOutput.Trim().Split('\n').Select(x => "<p>" + x + "</p>"))}";
                        ExceptionMessage += $"{Environment.NewLine}{Environment.NewLine}<p style=\"color:green\">================================ END BUILD OUTPUT ================================</p>";
                        ExceptionMessages.Add(ExceptionMessage);
                        return;
                    }

                    container.Image = ImageLink;
                    ImageLinks.Add(container.Name, ImageLink);
                    //await Console.Out.WriteLineAsync($"Build and Pushed: {ImageLink}");
                }));
            }

            await Task.WhenAll(TaskList);

            if (IsHaveException)
            {
                throw new Exception(string.Join(Environment.NewLine + Environment.NewLine + Environment.NewLine, ExceptionMessages));
            }

            // Đảm bảo mọi giá trị số như 123 sẽ được giữ nguyên là chuỗi khi serialize
            var serializer = new SerializerBuilder()
                .WithNamingConvention(CamelCaseNamingConvention.Instance)
                .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull)
                .WithDefaultScalarStyle(ScalarStyle.DoubleQuoted)  // Đảm bảo mọi giá trị đều được bao quanh bởi dấu ngoặc kép
                .Build();

            string yaml = serializer.Serialize(DeploymentConfigs);
            await File.WriteAllTextAsync(YamlPath, yaml);
            return ImageLinks;
        }

        /// <summary>
        /// This function will be remove docker images that service define
        /// </summary>
        /// <returns></returns>
        public async Task RemoveImageFromDiskAsync()
        {
            //Foreach container and deploy each other, then add image link to its (Multi threatasking)
            foreach (var container in DeploymentConfigs.Spec.Template.Spec.Containers)
            {
                string ImageLink = container.Image;
                if (!string.IsNullOrEmpty(ImageLink))
                {
                    await CmdHelper.ExecuteBashCommandAsync("", $"docker rmi {ImageLink}", true);
                }
            }
        }

        /// <summary>
        /// This function will be redeploy by deleted old deployment and create new deployment
        /// </summary>
        /// <param name="TeamId"></param>
        /// <returns></returns>
        public async Task DeployToK8s(int TeamId)
        {
            string DeploymentName = $"{ChallengeManagePathConfigs.ChallengeRootName}-{ChallengeId}-{TeamId}";
            //Delete old deployment
            await CmdHelper.ExecuteBashCommandAsync(ProjectPath, $"kubectl delete deployment {DeploymentName}", true);
            await Task.Delay(3000);
            bool IsPodDeleted = false;
            while (!IsPodDeleted)
            {
                string DeploymentList = await CmdHelper.ExecuteBashCommandAsync(ProjectPath, $"kubectl get deployments", true);
                if (!DeploymentList.Contains(DeploymentName))
                {
                    IsPodDeleted = true;
                }
                await Task.Delay(1000);
            }
            DeploymentConfigs.Metadata.Name = DeploymentName;

            // Đảm bảo mọi giá trị số như 123 sẽ được giữ nguyên là chuỗi khi serialize
            var serializer = new SerializerBuilder()
                .WithNamingConvention(CamelCaseNamingConvention.Instance)
                .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull)
                .WithDefaultScalarStyle(ScalarStyle.DoubleQuoted)  // Đảm bảo mọi giá trị đều được bao quanh bởi dấu ngoặc kép
                .Build();

            string yaml = serializer.Serialize(DeploymentConfigs);
            await File.WriteAllTextAsync(YamlPath, yaml);
            var DeployResult = await CmdHelper.ExecuteBashCommandAsync(ProjectPath, "kctf chal deploy", true);
            if (!DeployResult.Contains($"{DeploymentName} created") && !DeployResult.Contains($"{DeploymentName} configured"))
            {
                string ExceptionMessage = "<p style=\"color:green\">================================ BEGIN DEPLOY OUTPUT ================================</p>";
                ExceptionMessage += $"{Environment.NewLine}{string.Join("\n", DeployResult.Trim().Split('\n').Select(x => "<p>" + x + "</p>"))}";
                ExceptionMessage += $"{Environment.NewLine}<p style=\"color:green\">================================ END DEPLOY OUTPUT ================================</p>";
                throw new Exception(ExceptionMessage);
            }
        }

        /// <summary>
        /// This function will get pod name from input deployment name
        /// </summary>
        /// <param name="TeamId"></param>
        /// <returns></returns>
        public async Task<string?> GetPodNameFromDeployment(int TeamId)
        {
            //  System.await Console.Out.WriteLineAsync("Start get pod Name");
            string DeploymentName = $"{ChallengeManagePathConfigs.ChallengeRootName}-{ChallengeId}-{TeamId}";
            string? PodName = await CmdHelper.ExecuteBashCommandAsync("", $"kubectl get pods -n default | grep {DeploymentName} | grep -v Terminating", true);
            PodName = Regex.Replace(PodName, @"\s+", " ").Split(' ')[0];
            return PodName;
        }

        public async Task<string> GetDeploymentLogsAsync(int TeamId)
        {
            string? PodName = await GetPodNameFromDeployment(TeamId);
            //  System.await Console.Out.WriteLineAsync($"Pod Name: {PodName}");
            StringBuilder Logs = new StringBuilder();
            // System.await Console.Out.WriteLineAsync("Start Get Log Pods");
            foreach (var service in DeploymentConfigs.Spec.Template.Spec.Containers)
            {
                while (true)
                {
                    try
                    {
                        //    await Console.Out.WriteLineAsync($"Start get log {service.Name}");
                        Logs.AppendLine($"<p style=\"color:green\">================================ BEGIN {service.Name} LOGS ================================</p>");
                        Logs.AppendLine();
                        string ServicePath = $"/api/v1/namespaces/default/pods/{PodName}/log?container={service.Name}";
                        MultiServiceConnector connector = new MultiServiceConnector($"http://localhost:{ServiceConfigs.K8sPort}");
                        string data = (await connector.ExecuteNormalRequest(ServicePath, RestSharp.Method.Get, new(), RequestContentType.Query)) ?? "";
                        Logs.AppendLine(string.Join("\n", data.Trim().Split('\n').Select(x => "<p>" + x + "</p>")));
                        Logs.AppendLine($"<p style=\"color:green\">================================ END {service.Name} LOGS ================================</p>");
                        Logs.AppendLine();
                        Logs.AppendLine();
                        Logs.AppendLine();
                        break;
                    }
                    catch (Exception)
                    {
                        await Task.Delay(1000);
                    }
                }
            }

            return Logs.ToString().Trim();
        }

        // Hàm chính thực hiện port-forward và cấu hình Nginx
        public async Task<string> ForwardPort(int TeamId)
        {
            string DeploymentName = $"{ChallengeManagePathConfigs.ChallengeRootName}-{ChallengeId}-{TeamId}";
            var ConfigSettings = JsonConvert.DeserializeObject<Dictionary<string, string>>(File.ReadAllText(Path.Combine(ProjectPath, "settings.json")));
            if (ConfigSettings == null)
            {
                throw new Exception("ConfigSettings is invalid");
            }
            else if (!ConfigSettings.ContainsKey("TargetPort") || string.IsNullOrEmpty(ConfigSettings["TargetPort"]))
            {
                throw new Exception("ConfigSettings is missing or has an invalid 'TargetPort'");
            }
            else if (!ConfigSettings.ContainsKey("ChallengeType") || string.IsNullOrEmpty(ConfigSettings["ChallengeType"]))
            {
                throw new Exception("ConfigSettings is missing or has an invalid 'ChallengeType'");
            }

            string ConnectionString = string.Empty;
            string ChallengeType = ConfigSettings["ChallengeType"];
            int FreePort = GetAvailablePort();
            string PodName = await GetPodNameFromDeployment(TeamId) ?? "";

            //todo: need to check if pod is running

            // await Console.Out.WriteLineAsync($"Pod Name: {PodName}");
            //Port forward into FreePort
            _ = Task.Run(async () =>
            {
                await CmdHelper.ExecuteBashCommandAsync("", $"kubectl port-forward {PodName} {FreePort}:{ConfigSettings["TargetPort"]} | grep -v \"Handling connection\"", true);
            });
            await Task.Delay(1500);

            if (EnvironmentConfigs.ENVIRONMENT_NAME == "DEV")
            {
                if (ChallengeType.Equals("web", StringComparison.CurrentCultureIgnoreCase))
                {
                    ConnectionString = $"localhost:{FreePort}";
                }
                else if (ChallengeType.Equals("pwn", StringComparison.CurrentCultureIgnoreCase))
                {
                    ConnectionString = $"Host: 127.0.0.1 - Port: {FreePort}";
                }
            }
            else if (EnvironmentConfigs.ENVIRONMENT_NAME == "PRODUCTION")
            {
                if (ChallengeType.Equals("web", StringComparison.CurrentCultureIgnoreCase))
                {
                    string SubDomain = $"{Guid.NewGuid()}.{ServiceConfigs.DomainName}";
                    await ConfigureNginx(SubDomain, FreePort);
                    ConnectionString = SubDomain;
                }
                else if (ChallengeType.Equals("pwn", StringComparison.CurrentCultureIgnoreCase))
                {
                    int SSHPort = await ConfigurePwnablePort(FreePort);
                    ConnectionString = $"Host: {ServiceConfigs.DomainName} - Port: {SSHPort}";
                }
            }
            DeploymentInfo deploymentInfo = new DeploymentInfo()
            {
                ChallengeId = ChallengeId,
                DeploymentPort = FreePort,
                DeploymentDomainName = ConnectionString,
                LastDeployTime = DateTime.Now,
                PodName = PodName,
                ServerId = MachineConfigs.ServerId,
                TeamId = TeamId
            };

            await SaveDeploymentInfo(deploymentInfo);

            return ConnectionString;
        }

        public async Task StopChallengeAsync(int TeamId)
        {
            string DeploymentName = $"{ChallengeManagePathConfigs.ChallengeRootName}-{ChallengeId}-{TeamId}";

            //Delete deployment
            await CmdHelper.ExecuteBashCommandAsync("", $"kubectl delete deployment {DeploymentName}", true);

            var ConfigSettings = JsonConvert.DeserializeObject<Dictionary<string, string>>(File.ReadAllText(Path.Combine(ProjectPath, "settings.json")));
            if (ConfigSettings == null)
            {
                throw new Exception("ConfigSettings is invalid");
            }
            else if (string.IsNullOrEmpty(ConfigSettings["TargetPort"]) || !int.TryParse(ConfigSettings["TargetPort"], out _))
            {
                throw new Exception("ConfigSettings is missing or wrong TargetPort");
            }

            RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);

            var deploymentList = await redisHelper.GetFromCacheAsync<List<DeploymentInfo>>(RedisConfigs.RedisChallengeDeploymentListKey);
            if (deploymentList == null || deploymentList.Count < 0)
            {
                deploymentList = new List<DeploymentInfo>();
            }

            var TargetDeployment = deploymentList.FirstOrDefault(x => x.TeamId == TeamId && x.ChallengeId == ChallengeId);
            if (TargetDeployment == null)
            {
                await Console.Out.WriteLineAsync("TargetDeployment == null");
                return;
                //throw new Exception("Lỗi không tìm thấy Deployment trong cache (Kiểm tra lại team id và Challange ID)");
            }

            int TargetPort = TargetDeployment.DeploymentPort;

            if (TargetPort == 0)
            {
                return;
            }

            try
            {
                // Thực thi lệnh lsof để lấy PID
                string command = $"lsof -t -i:{TargetPort}";
                string pid = await CmdHelper.ExecuteBashCommandAsync("", command, false);

                if (!string.IsNullOrEmpty(pid))
                {
                    // Kill tiến trình
                    await CmdHelper.ExecuteBashCommandAsync("", $"kill -9 {pid}", false);
                    // await Console.Out.WriteLineAsync($"Tiến trình PID {pid} đã bị dừng.");
                }

                string SubDomain = TargetDeployment.DeploymentDomainName.Contains(" - ") ? "" : TargetDeployment.DeploymentDomainName;
                string nginxConfigPath = $"/etc/nginx/sites-available/{SubDomain}";
                string nginxConfigPath2 = $"/etc/nginx/sites-enabled/{SubDomain}";
                if (File.Exists(nginxConfigPath))
                {
                    Console.WriteLine($"Deleting NGINX config file: {nginxConfigPath}");
                    File.Delete(nginxConfigPath);
                }

                if (File.Exists(nginxConfigPath2))
                {
                    Console.WriteLine($"Deleting NGINX symbolic link: {nginxConfigPath2}");
                    File.Delete(nginxConfigPath2);
                }

                // Kiểm tra cấu hình
                await CmdHelper.ExecuteBashCommandAsync("", "sudo nginx -t", false);
                // await Console.Out.WriteLineAsync("NGINX config test");

                //reload NGINX
                await CmdHelper.ExecuteBashCommandAsync("", "sudo systemctl reload nginx", false);
                //  await Console.Out.WriteLineAsync("NGINX reloaded");

                //Delete rule
                await CmdHelper.ExecuteBashCommandAsync("", $"sudo ufw delete allow {TargetPort}/tcp", false);
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync($"Lỗi khi dừng tiến trình: {ex.Message}");
            }
        }

        private int GetAvailablePort()
        {
            // Tạo socket với loại TCP
            using (var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp))
            {
                // Sử dụng endpoint với IP bất kỳ và cổng 0 để yêu cầu cấp phát cổng rảnh
                socket.Bind(new IPEndPoint(IPAddress.Any, 0));

                // Lấy số cổng được cấp phát
                int port = ((IPEndPoint)socket.LocalEndPoint!).Port;

                // Đóng socket để giải phóng cổng
                socket.Close();

                return port;
            }
        }
        
        private int GetAvailablePort(int fromPort, int toPort, bool randomize = true)
        {
            Random _rnd = new Random();
            // 1. Lấy các port TCP đang Listen
            var ipProps = IPGlobalProperties.GetIPGlobalProperties();
            var usedPorts = new HashSet<int>(
                ipProps.GetActiveTcpListeners().Select(ep => ep.Port)
            );

            // 2. Tập các port trong khoảng chưa bị chiếm
            var freePorts = Enumerable
                .Range(fromPort, toPort - fromPort + 1)
                .Where(p => !usedPorts.Contains(p))
                .ToList();

            if (!freePorts.Any())
                throw new InvalidOperationException(
                    $"Không tìm được cổng TCP trống từ {fromPort} đến {toPort}.");

            // 3. Trả về cổng: ngẫu nhiên hoặc port đầu tiên của list
            return randomize
                ? freePorts[_rnd.Next(freePorts.Count)]
                : freePorts[0];
        }


        // Hàm cấu hình Nginx
        private async Task ConfigureNginx(string SubDomain, int TargetPort)
        {
            // Đường dẫn file cấu hình NGINX
            string nginxConfigPath = $"/etc/nginx/sites-available/{SubDomain}";

            // Nội dung file cấu hình (SSL)
//             string nginxConfig = $@"
// server {{
//     listen 443 ssl;
//     server_name {SubDomain};

//     ssl_certificate /etc/nginx/ssl/fullchain.crt;
//     ssl_certificate_key /etc/nginx/ssl/private.key;

//     location / {{
//         proxy_pass http://127.0.0.1:{TargetPort};
//         proxy_set_header Host $host;
//         proxy_set_header X-Real-IP $remote_addr;
//         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
//         proxy_set_header X-Forwarded-Proto $scheme;
//     }}
// }}";

            // Nội dung file cấu hình (No SSL)
string nginxConfig = $@"
server {{
    listen 80;
    server_name {SubDomain};

    location / {{
        proxy_pass http://127.0.0.1:{TargetPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
}}";
            try
            {
                // Tạo file cấu hình NGINX
                File.WriteAllText(nginxConfigPath, nginxConfig);
                //  await Console.Out.WriteLineAsync("NGINX config file created successfully.");

                // Tạo symbolic link
                string output = await CmdHelper.ExecuteBashCommandAsync("", $"sudo ln -s /etc/nginx/sites-available/{SubDomain} /etc/nginx/sites-enabled/", false);
                await Console.Out.WriteLineAsync($"NGINX symbolic link created by: sudo ln -s /etc/nginx/sites-available/{SubDomain} /etc/nginx/sites-enabled/");
                await Console.Out.WriteLineAsync("NGINX symbolic link created: "+ output);

                // Kiểm tra cấu hình
                output = await CmdHelper.ExecuteBashCommandAsync("", "sudo nginx -t", false);
                await Console.Out.WriteLineAsync("NGINX config test: "+ output);

                //reload NGINX
                output = await CmdHelper.ExecuteBashCommandAsync("", "sudo systemctl reload nginx", false);
                await Console.Out.WriteLineAsync("NGINX reloaded: "+ output);

                // Tự động cài đặt HTTPS
                //output = await CmdHelper.ExecuteBashCommandAsync("", $"sudo certbot --nginx -d {SubDomain} --redirect --non-interactive --agree-tos --email your-email@example.com", false);
                //await Console.Out.WriteLineAsync("SSL certificate applied: ");
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync($"Error: {ex.Message}");
            }
        }

        private async Task<int> ConfigurePwnablePort(int TargetPort)
        {
            int FreePort = GetAvailablePort(ServiceConfigs.PwnPortRangeFrom,ServiceConfigs.PwnPortRangeTo);

            // await Console.Out.WriteLineAsync($"Start forward ssh - Free Port: {FreePort}");

            _ = Task.Run(async () =>
                 {
                     await CmdHelper.ExecuteBashCommandAsync("", $"socat TCP-LISTEN:{FreePort},reuseaddr,fork TCP:127.0.0.1:{TargetPort}", false);
                 });

            await CmdHelper.ExecuteBashCommandAsync("", $"sudo ufw allow {FreePort}/tcp", false);

            await Task.Delay(1000);

            return FreePort;
        }
        private async Task SaveDeploymentInfo(DeploymentInfo deploymentInfo)
        {
            try
            {
                RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);

                var deploymentList = await redisHelper.GetFromCacheAsync<List<DeploymentInfo>>(RedisConfigs.RedisChallengeDeploymentListKey);
                if (deploymentList == null || deploymentList.Count < 0)
                {
                    deploymentList = new List<DeploymentInfo>();
                }

                deploymentList.Add(deploymentInfo);

                await redisHelper.SetCacheAsync(RedisConfigs.RedisChallengeDeploymentListKey, deploymentList, TimeSpan.FromDays(90));

            }
            catch (Exception ex)
            {
                // Log or handle error in background task
                Console.Error.WriteLine($"Error in background task: {ex.Message}");
            }
        }
        public async Task<bool> CheckPodStatusAsync(int TeamId)
        {
            bool IsPodRunningAll = true;
            string PodName = await GetPodNameFromDeployment(TeamId) ?? "";
            await Console.Out.WriteLineAsync($"get PodName name (CheckPodStatus function): {PodName}");

            string PodStatus = await CmdHelper.ExecuteBashCommandAsync("", $"kubectl get pod {PodName} -o=jsonpath='{{range .status.containerStatuses[*]}}{{.name}}: {{.state}}|{{end}}'", true);
            await Console.Out.WriteLineAsync($"Pod Status: {PodStatus}");
            string[] PodStatuses = PodStatus.Split('|').Where(x => x.Contains('{')).ToArray();
            await Console.Out.WriteLineAsync($"Pod Statuses: {PodStatuses}");
            await Console.Out.WriteLineAsync($"Pod Statuses.Length: {PodStatuses.Length}");
            string ExceptionMessage = "";
            foreach (var pod in PodStatuses)
            {
                await Console.Out.WriteLineAsync($"Check pod status: {pod}");
                string ServiceName = pod.Split(':')[0].Trim();
                await Console.Out.WriteLineAsync($"Check pod status - service: {ServiceName}");
                JObject Status = JObject.Parse(string.Join(":", pod.Split(':').Skip(1)).Trim());
                await Console.Out.WriteLineAsync($"Check pod status - status: {Status}");
                await Console.Out.WriteLineAsync((Status["running"] != null && Status["running"]!["startedAt"] != null).ToString());
                if (Status["running"] != null && Status["running"]!["startedAt"] != null)
                {
                    await Console.Out.WriteLineAsync($"Status[\"running\"]: {Status["running"]} - Status: {Status["running"]!["startedAt"]}");
                    continue;
                }

                //De quy neu pod dang trong trang thai ContainerCreating
                if (Status["waiting"] != null && Status["waiting"]!["reason"]!.ToString() == "ContainerCreating")
                {
                    await Console.Out.WriteLineAsync($"Status[\"waiting\"]: {Status["waiting"]}, Status[\"waiting\"]![\"reason\"]: {Status["waiting"]!["reason"]}");
                    await Console.Out.WriteLineAsync($"Waiting for {ServiceName} creating...");
                    await Task.Delay(5000);
                    return await CheckPodStatusAsync(TeamId);
                }

                ExceptionMessage += $"<p style=\"color:red\">================================ BEGIN POD {ServiceName} ERROR ================================</p>";
                ExceptionMessage += $"<p>Reason: {Status}.</p>";
                ExceptionMessage += $"<p style=\"color:red\">================================ END POD {ServiceName} ERROR ================================</p>";
                IsPodRunningAll = false;
            }

            if (!IsPodRunningAll)
            {
                throw new Exception(ExceptionMessage);
            }

            return true;
        }
    }
}
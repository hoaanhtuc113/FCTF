using ChallengeManagementServer.Configs;
using ChallengeManagementServer.ServiceInterfaces;
using ChallengeManagementServer.Utils;
using Newtonsoft.Json;
using ResourceShared.Configs;
using ResourceShared.Models;
using ResourceShared.ResponseViews;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.IO.Compression;
using System.Text;

namespace ChallengeManagementServer.Services
{
    public class ChallengeService : IChallengeService
    {
        IConnectionMultiplexer _connectionMultiplexer;
        public ChallengeService(IConnectionMultiplexer connectionMultiplexer)
        {
            _connectionMultiplexer = connectionMultiplexer;
        }
        public async Task BuildDeployAndUpdatetoCDAsync(int ChallengeId)
        {
            int TeamId = -1;
            K8sHelper k8s = new K8sHelper(ChallengeId, _connectionMultiplexer);
            try
            {
                #region Build and deploy

                //Build
                var ImageLink = await k8s.BuildImagesAndUpdateYamlAsync();

                //Deploy
                await k8s.DeployToK8s(TeamId);

                //Get pod log to confirm that the deployment is successful
                await k8s.CheckPodStatusAsync(TeamId);

                //Get logs
                string DeployLogs = await k8s.GetDeploymentLogsAsync(TeamId);

                //await Console.Out.WriteLineAsync(DeployLogs);

                #endregion

                try
                {
                    await UpdateChallengeStatusToCTFd(ChallengeId, DeployLogs, "DEPLOY_SUCCESS", JsonConvert.SerializeObject(ImageLink));

                    #region Save deployment info to Redis
                    RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
                    string deployKey = $"{RedisConfigs.RedisDeployKey}{ChallengeId}";
                    var deploymentInfo = new DeploymentInfo
                    {
                        ChallengeId = ChallengeId,
                        ServerId = MachineConfigs.ServerId,
                        LastDeployTime = DateTime.Now,
                        DeploymentDomainName = "",
                        DeploymentPort = 0
                    };
                    TimeSpan expireTime = TimeSpan.FromDays(365);
                    await redisHelper.SetCacheAsync(deployKey, deploymentInfo, expireTime);
                    #endregion
                }
                catch (Exception ex)
                {
                    await Console.Out.WriteLineAsync(ex.Message);
                    throw;
                }
            }
            catch (Exception ex)
            {
                //await Console.Out.WriteLineAsync(ex.Message+ " (line67)");
                string DeployLogs = await k8s.GetDeploymentLogsAsync(TeamId);
                throw new Exception(ex.Message + $"\n\n{DeployLogs}");
            }
        }

        public async Task UpdateChallengeStatusToCTFd(int ChallengeId, string DeployLogs, string status, string ImageLink = "{}")
        {
            #region Update challenge status to CTFd
            long UnixTime = DateTimeHelper.GetDateTimeNowInUnix();
            Dictionary<string, string> parameters = new()
                    {
                        {  "ChallengeId",ChallengeId.ToString()},
                        {  "ChallengeLogs",DeployLogs},
                        {  "ChallengeStatus",status},
                        {  "ImageLink", ImageLink},
                    };
            string secretkey = SecretKeyHelper.CreateSecretKey(UnixTime, parameters);

            var request = new RestRequest();
            request.Method = Method.Post;
            request.Resource = "api/v1/challenges/update-info-by-cs";
            request.AddHeader("SecretKey", secretkey);
            Dictionary<string, object> requestDictionary = new Dictionary<string, object>
             {
                        {  "ChallengeId",ChallengeId},
                        {  "UnixTime", UnixTime},
                        {  "ChallengeLogs",DeployLogs},
                        {  "ChallengeStatus", status},
                        {  "ImageLink", ImageLink},
             };

            MultiServiceConnector multiServiceConnector = new MultiServiceConnector(ServiceConfigs.CTFdBaseUrl);
            await multiServiceConnector.ExecuteRequest<GeneralView>(request, requestDictionary, RequestContentType.Form);
            #endregion
        }
        public Task<string> GetDeploymentLogsAsync(int ChallengeId, int TeamId)
        {
            throw new Exception("Not implemented");
            //try
            //{
            //    K8sHelper k8s = new K8sHelper(ChallengeId);
            //    await k8s.GetDeploymentLogs(TeamId);
            //}
            //catch (Exception)
            //{
            //    throw;
            //}
        }
        /// <summary>
        /// Method using to upload challenge .zip file from request to local machine
        /// </summary>
        public async Task<bool> SaveFileAsync(int ChallangeId, IFormFile file)
        {
            try
            {
                // Create the temp directory to save .zip file before extraction to challenge directory
                if (!Directory.Exists(ChallengeManagePathConfigs.TempDirectoryPath))
                {
                    Directory.CreateDirectory(ChallengeManagePathConfigs.TempDirectoryPath);
                }

                // Check file upload
                if (file == null)
                {
                    throw new Exception("Upload file fail. File not found");
                }

                // Check the file extension
                var contentType = file.ContentType;
                if (Path.GetExtension(file.FileName).ToLower() != ".zip"
                 || (contentType != "application/zip" && contentType != "application/x-zip-compressed"))
                {
                    throw new Exception("Upload file fail. File zip only");
                }

                // Create temp file path to save zip file
                string? fileName = $"{ChallengeManagePathConfigs.ChallengeRootName}-{ChallangeId}.zip";
                string? filePath = Path.Combine(ChallengeManagePathConfigs.TempDirectoryPath, fileName);

                using (var stream = new FileStream(filePath, FileMode.Create))
                {
                    await file.CopyToAsync(stream);
                }

                // Extract the zip file to the challenge directory
                string extractionDistPath = Path.Combine(ChallengeManagePathConfigs.ChallengeBasePath, $"{ChallengeManagePathConfigs.ChallengeRootName}-{ChallangeId}");

                if (Directory.Exists(extractionDistPath))
                {
                    await CmdHelper.ExecuteBashCommandAsync("", $"chmod -R 777 \"{extractionDistPath}\"", false);
                    Directory.Delete(extractionDistPath, true);
                }

                Directory.CreateDirectory(extractionDistPath);
                ZipFile.ExtractToDirectory(filePath, extractionDistPath);

                var (ValidateResult, ValidateMessage) = ValidateFilePath(ChallangeId);
                if (!ValidateResult)
                {
                    throw new Exception(ValidateMessage);
                }
                await ValidateSettingsFile(Path.Combine(extractionDistPath, "settings.json"));
                await CmdHelper.ExecuteBashCommandAsync("", $"chmod -R 777 \"{extractionDistPath}\"", false);
                return true;
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync(ex.Message);
                throw;
            }
        }
        public async Task<string> StartAsync(int ChallengeId, int TeamId)
        {
            try
            {
                K8sHelper k8s = new K8sHelper(ChallengeId, _connectionMultiplexer);

                await k8s.DeployToK8s(TeamId);

                //Nếu là preview instance thì cần throw lỗi để update pod status sang CD
                if (TeamId == -1)
                {
                    await k8s.CheckPodStatusAsync(TeamId);
                }
                else
                {
                    //Nếu là thí sinh thì cần chờ đến khi toàn bộ Pod đã run
                    while (true)
                    {
                        try
                        {
                            await k8s.CheckPodStatusAsync(TeamId);
                            break;
                        }
                        catch (Exception)
                        {
                            await Task.Delay(1500);
                        }
                    }
                }

                string ConnectionString = await k8s.ForwardPort(TeamId);
                return ConnectionString;
            }
            catch (Exception)
            {
                throw;
            }
        }
        public async Task<bool> StopAsync(int ChallengeId, int TeamId)
        {
            try
            {
                K8sHelper k8s = new K8sHelper(ChallengeId, _connectionMultiplexer);
                await k8s.StopChallengeAsync(TeamId);
                return true;
            }
            catch (Exception)
            {
                throw;
            }
        }
        private async Task<bool> ValidateSettingsFile(string SettingsFile)
        {
            var ConfigSettings = JsonConvert.DeserializeObject<Dictionary<string, string>>(await System.IO.File.ReadAllTextAsync(SettingsFile));
            if (ConfigSettings == null)
            {
                throw new Exception("ConfigSettings is invalid");
            }
            else if (string.IsNullOrEmpty(ConfigSettings["TargetPort"]) || !int.TryParse(ConfigSettings["TargetPort"], out _))
            {
                throw new Exception("ConfigSettings is missing or wrong TargetPort. This value must be integer data type");
            }
            else if (string.IsNullOrEmpty(ConfigSettings["ChallengeType"]) ||(!ConfigSettings["ChallengeType"].Equals("pwn") && !ConfigSettings["ChallengeType"].Equals("web")))
            {
                throw new Exception("ConfigSettings is missing or wrong ChallengeType. This value must be \"pwn\" or \"web\"");
            }
            return true;
        }

        private (bool, string) ValidateFilePath(int ChallangeId)
        {
            string rootPath = Path.Combine(ChallengeManagePathConfigs.ChallengeBasePath, $"{ChallengeManagePathConfigs.ChallengeRootName}-{ChallangeId}");
            List<string> pathsToCheck = new List<string>
    {
        Path.Combine("challenge"),
        Path.Combine("challenge.yaml"),
        Path.Combine("settings.json")
    };

            try
            {
                K8sHelper k8s = new K8sHelper(ChallangeId, _connectionMultiplexer);
                foreach (var container in k8s.DeploymentConfigs.Spec.Template.Spec.Containers)
                {
                    pathsToCheck.Add(Path.Combine("challenge", container.Name));
                    pathsToCheck.Add(Path.Combine("challenge", container.Name, "Dockerfile"));
                }
            }
            catch (Exception)
            {
                // Handle exception silently
            }

            bool allExist = true;
            var missingPaths = new HashSet<string>();
            var treeBuilder = new StringBuilder();

            // Normalize paths
            string NormalizePath(string path) => Path.Combine(rootPath, path);

            // Check existence and mark missing
            if (!Directory.Exists(rootPath))
            {
                allExist = false;
                missingPaths.Add(string.Empty); // Add root as missing
            }

            foreach (var path in pathsToCheck)
            {
                var fullPath = NormalizePath(path);
                if (!System.IO.File.Exists(fullPath) && !Directory.Exists(fullPath))
                {
                    allExist = false;
                    missingPaths.Add(path);
                }
            }

            // Build tree structure from pathsToCheck
            void BuildTreeFromPaths()
            {
                var pathDict = new Dictionary<string, List<string>>();

                foreach (var path in pathsToCheck)
                {
                    var parts = path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    string current = string.Empty;
                    foreach (var part in parts)
                    {
                        if (!pathDict.ContainsKey(current))
                        {
                            pathDict[current] = new List<string>();
                        }
                        var next = string.IsNullOrEmpty(current) ? part : Path.Combine(current, part);
                        if (!pathDict[current].Contains(next))
                        {
                            pathDict[current].Add(next);
                        }
                        current = next;
                    }
                }

                void RecursiveBuild(string parent, string indent, bool isLast)
                {
                    if (pathDict.ContainsKey(parent))
                    {
                        var children = pathDict[parent];
                        for (int i = 0; i < children.Count; i++)
                        {
                            var child = children[i];
                            var isLastChild = i == children.Count - 1;
                            string DirName = Path.GetFileName(rootPath);
                            var relativePath = Path.GetRelativePath(DirName, child);
                            var isMissing = missingPaths.Contains(child);
                            var displayName = Path.GetFileName(child);

                            // Add `|` and `---` symbols
                            treeBuilder.AppendLine($"{indent}{(isLast ? "└── " : "├── ")}{displayName}{(isMissing ? " [MISSING]" : "")}");

                            // Recurse with adjusted indent
                            RecursiveBuild(
                                child,
                                indent + (isLast ? "    " : "│   "),
                                isLastChild
                            );
                        }
                    }
                }

                // Root display
                //treeBuilder.AppendLine($"--- {Path.GetFileName(rootPath)}{(missingPaths.Contains(string.Empty) ? " [MISSING]" : "")}");
                RecursiveBuild(string.Empty, "", false);
            }

            BuildTreeFromPaths();

            return (allExist, allExist ? string.Empty : "<pre>"+treeBuilder.ToString()+"</pre>");
        }
    }
}

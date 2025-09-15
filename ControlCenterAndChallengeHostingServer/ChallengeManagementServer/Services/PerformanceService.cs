using System.Collections.Generic;
using System.Diagnostics;
using ChallengeManagementServer.Configs;
using ChallengeManagementServer.DTO;
using ChallengeManagementServer.K8sServerResponse.GetClusterStatisticResponseDTO;
using ChallengeManagementServer.K8sServerResponse.GetPodStatisticResponseDTO;
using ChallengeManagementServer.DTO.PerformanceStatDTO;
using ChallengeManagementServer.ServiceInterfaces;
using ChallengeManagementServer.Utils;
using ResourceShared.Models;
using Newtonsoft.Json;
using ResourceShared.Configs;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;

namespace ChallengeManagementServer.Services
{

    public class PerformanceService : IPerformanceService
    {
        private readonly Process _process;

        IConnectionMultiplexer _connectionMultiplexer;

        public PerformanceService(IConnectionMultiplexer connectionMultiplexer)
        {
            _process = Process.GetCurrentProcess();
            _connectionMultiplexer = connectionMultiplexer;
        }

        public async Task<CpuUsageDTO> GetCpuUsageAsync()
        {
            float cpuUsage = 0;
            string cpuInfoFile = "/proc/cpuinfo";
            string[] cpustat;

            try
            {
                // Read CPU statistics asynchronously
                cpustat = await System.IO.File.ReadAllLinesAsync("/proc/stat");

                if (cpustat.Length > 0)
                {
                    // Get the first line which contains CPU usage information
                    string[] cpustatinfo = cpustat[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (cpustatinfo.Length >= 5)
                    {
                        // Parse user, nice, system, idle, and iowait times
                        long user = long.Parse(cpustatinfo[1]);
                        long nice = long.Parse(cpustatinfo[2]);
                        long system = long.Parse(cpustatinfo[3]);
                        long idle = long.Parse(cpustatinfo[4]);
                        long iowait = long.Parse(cpustatinfo[5]);

                        // Calculate total and idle time
                        long totalCpuTime = user + nice + system + idle + iowait;
                        long totalIdleTime = idle + iowait;

                        // Calculate CPU usage percentage
                        cpuUsage = (float)(100.0 * (1.0 - ((double)totalIdleTime / totalCpuTime)));
                    }
                }

                string cpuModel = "";
                float baseSpeed = 0;
                using (StreamReader reader = new StreamReader(cpuInfoFile))
                {
                    string? line;
                    while ((line = await reader.ReadLineAsync()) != null)
                    {
                        if (line.StartsWith("model name"))
                        {
                            cpuModel = line.Split(':')[1].Trim();
                        }
                        else if (line.StartsWith("cpu MHz"))
                        {
                            baseSpeed = (float)ParseMemoryValue(line) / 1024;
                        }
                    }
                }

                return new CpuUsageDTO
                {
                    CpuUsage = cpuUsage,
                    Model = cpuModel,
                    BaseSpeed = baseSpeed
                };
            }
            catch (IOException ex)
            {
                await Console.Out.WriteLineAsync(ex.Message);
                throw;
            }
        }

        public async Task<MemoryStatsDTO> GetMemoryUsageAsync()
        {
            try
            {
                string memInfoFile = "/proc/meminfo";
                float totalMemory = 0;
                float freeMemory = 0;
                float availableMemory = 0;
                float cached = 0;

                using (StreamReader reader = new StreamReader(memInfoFile))
                {
                    string? line;
                    while ((line = await reader.ReadLineAsync()) != null)
                    {
                        // Parse relevant lines for memory usage
                        if (line.StartsWith("MemTotal:"))
                        {
                            totalMemory = (float)ParseMemoryValue(line) / (1024 * 1024); // Convert to GB
                        }
                        else if (line.StartsWith("MemFree:"))
                        {
                            freeMemory = (float)ParseMemoryValue(line) / (1024 * 1024); // Convert to GB
                        }
                        else if (line.StartsWith("MemAvailable:"))
                        {
                            availableMemory = (float)ParseMemoryValue(line) / (1024 * 1024); // Convert to GB
                        }
                        else if (line.StartsWith("Cached:"))
                        {
                            cached = (float)ParseMemoryValue(line) / (1024 * 1024); // Convert to GB
                        }

                    }
                };

                return new MemoryStatsDTO
                {
                    TotalMemory = totalMemory,
                    FreeMemory = freeMemory,
                    AvailableMemory = availableMemory,
                    Cached = cached,

                };
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync(ex.Message);
                throw;
            }

        }

        // Method to parse memory values from the meminfo file
        private float ParseMemoryValue(string line)
        {
            // Split line and convert the second part (value) to long
            string[] parts = line.Split(':');
            return float.Parse(parts[1].Trim().Split(' ')[0]); // Get the value before any unit
        }

        public async Task<PodStatisticInfo?> GetPerformancePod(int ChallengeId, int TeamId)
        {
            try
            {
                #region get pod statistice usage
                K8sHelper k8SHelper = new K8sHelper(ChallengeId, _connectionMultiplexer);
                string? podName = await k8SHelper.GetPodNameFromDeployment(TeamId);
                string ServicePath = $"/apis/metrics.k8s.io/v1beta1/namespaces/default/pods/{podName}";
                MultiServiceConnector connector = new MultiServiceConnector($"http://localhost:{ServiceConfigs.K8sPort}");
                string getJsonPodStatistic
                        = await connector.ExecuteNormalRequest(ServicePath, RestSharp.Method.Get, new(), RequestContentType.Query) ?? "";
                var podStatistic = JsonConvert.DeserializeObject<GetPodStatisticResponseDTO>(getJsonPodStatistic);
                if (podStatistic == null || podStatistic.Containers.Count < 0)
                {
                    throw new Exception($"Get Performance failed for challenge {ChallengeId}, team {TeamId}");
                }
                #endregion get pod statistice usage

                #region convert to %

                // cpu usage by nanoseconds
                long totalCpuUsage = 0;

                // ram usage by Ki
                long totalMemoryUsage = 0;

                // Get total cpu, ram usage of all containers running in pod
                foreach (var container in podStatistic.Containers)
                {
                    totalCpuUsage += long.Parse(container.Usage.Cpu.Replace("n", ""));
                    totalMemoryUsage += long.Parse(container.Usage.Memory.Replace("Ki", ""));
                }

                #endregion convert to %

                PodStatisticInfo statisticResponseInfo = new PodStatisticInfo
                {
                    TeamId = TeamId,
                    ChallengeId = ChallengeId,
                    PodName = podStatistic.Metadata.Name,
                    CpuUsage = totalCpuUsage,
                    RAMUsage = totalMemoryUsage,
                    ServerId = MachineConfigs.ServerId,
                };
                return statisticResponseInfo;
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync(ex.Message);
                return null;
            }
        }

        public async Task<ClusterStatisticResponseInfo> GetClusterStatistic()
        {
            try
            {
                #region get cluster statistice usage
                string ServicePath = $"/api/v1/nodes/kctf-cluster-control-plane/proxy/stats/summary";
                MultiServiceConnector connector = new MultiServiceConnector($"http://localhost:{ServiceConfigs.K8sPort}");
                string getJsonClusterStatistic
                        = await connector.ExecuteNormalRequest(ServicePath, RestSharp.Method.Get, new(), RequestContentType.Query) ?? "";
                var clusterStatistic = JsonConvert.DeserializeObject<ClusterStatisticResponseInfo>(getJsonClusterStatistic);
                if (clusterStatistic == null || clusterStatistic.Node == null)
                {
                    throw new Exception("Get Cluster Statistice failed");
                }
                #endregion get cluster statistice usage

                #region mapping data

                #endregion

                return clusterStatistic;
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync(ex.Message);
                throw;
            }
        }

        //TO DO
        public async Task<List<PodStatisticInfo>> GetAllPodStatistic(IConnectionMultiplexer _connectionMultiplexer)
        {
            try
            {
                #region get list statistic
                RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
                var deploymentList = await redisHelper.GetFromCacheAsync<List<DeploymentInfo>>(RedisConfigs.RedisChallengeDeploymentListKey);
                if (deploymentList == null || deploymentList.Count < 0)
                {
                    return new List<PodStatisticInfo>();
                }


                ClusterStatisticResponseInfo clusterInfo = await GetClusterStatistic();

                if (clusterInfo == null || clusterInfo.Pods.Count < 0)
                {
                    throw new Exception("Failed to get cluster all pod statistic");
                }

                List<Pod> podStatisticList = clusterInfo.Pods.ToList();

                var tasks = new List<Task>();

                List<PodStatisticInfo> statisticPodsList = new List<PodStatisticInfo>();
                foreach (var deployment in deploymentList)
                {
                    tasks.Add(Task.Run(() =>
                    {
                        Pod? pod = podStatisticList.Where(pod => deployment.PodName.Equals(pod.PodRef.Name)).FirstOrDefault();
                        if (pod != null)
                        {
                            long totalCpuAllocatable = KCTFUsageConfig.CPUAllocatable * 1000 * 1000 * 1000;
                            long totalMemoryAllocatable = KCTFUsageConfig.MemoryAllocatable;

                            double cpuUsagePercent = (double)pod.Cpu.UsageNanoCores / totalCpuAllocatable * 100;
                            double memoryUsageMi = (double)pod.Memory.UsageBytes / (1024 * 1024);

                            cpuUsagePercent = Math.Round(cpuUsagePercent, 4);
                            memoryUsageMi = Math.Round(memoryUsageMi, 2);

                            lock (statisticPodsList) // Lock để tránh xung đột khi truy cập vào danh sách
                            {
                                PodStatisticInfo statisticPod = new PodStatisticInfo
                                {
                                    ChallengeId = deployment.ChallengeId,
                                    TeamId = deployment.TeamId,
                                    CpuUsage = cpuUsagePercent,
                                    RAMUsage = memoryUsageMi,
                                    PodName = deployment.PodName,
                                };
                                statisticPodsList.Add(statisticPod);
                            }
                        }

                    }));

                    // Chờ tất cả các tác vụ hoàn thành
                    await Task.WhenAll(tasks);

                }
                return statisticPodsList;
                #endregion
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync(ex.Message);
                throw;
            }
        }

        public async Task<ClusterStatisticInfo> GetClusterCPUAndRAMUsage()
        {

            ClusterStatisticResponseInfo clusterStatistic = await GetClusterStatistic();
            if (clusterStatistic == null || clusterStatistic.Node == null)
            {
                throw new Exception("Get Cluster Statistice failed");
            }

            long totalCpuAllocatable = KCTFUsageConfig.CPUAllocatable * 1000 * 1000 * 1000;
            long totalMemoryAllocatable = KCTFUsageConfig.MemoryAllocatable;

            double cpuUsagePercent = (double)clusterStatistic.Node.Cpu.UsageNanoCores / totalCpuAllocatable * 100;
            double memoryUsageMi = (double)clusterStatistic.Node.Memory.UsageBytes / (1024 * 1024);
            double memoryAvailabeMi = (double)clusterStatistic.Node.Memory.AvailableBytes / (1024 * 1024);
            double memoryTotalMi = (double)(clusterStatistic.Node.Memory.AvailableBytes + clusterStatistic.Node.Memory.UsageBytes) / (1024 * 1024);


            ClusterStatisticInfo clusterStatisticInfo = new ClusterStatisticInfo()
            {
                CpuUsage = cpuUsagePercent,
                RamAvailable = memoryAvailabeMi,
                RamTotal = memoryTotalMi,
                ServerId = MachineConfigs.ServerId,
            };
            return clusterStatisticInfo;
        }

        public async Task<ClusterUsageByPercent> GetClusterUsageByPercent()
        {
            try
            {
                var output = await CmdHelper.ExecuteBashCommandAsync("", "kubectl top nodes", true);

                string[] lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                foreach (var line in lines)
                {
                    string[] columns = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (columns.Length >= 4 && columns[0] == "kctf-cluster-control-plane")
                    {
                        return new ClusterUsageByPercent
                        {
                            ServerId = MachineConfigs.ServerId,
                            CpuUsage = Double.Parse(columns[2].Trim('%')),
                            RamUsage = Double.Parse(columns[4].Trim('%'))

                        };
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Lỗi khi lấy dữ liệu cluster usage: {ex.Message}");
            }

            return null;
        }
    }
}

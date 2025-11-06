using k8s;
using k8s.Models;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Configs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Models;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using static ResourceShared.Enums;

namespace ResourceShared.Services
{
    public interface IK8sService
    {
        Task<bool> CheckPodAliveAsync(string podName, string namespaceName);
        Task<bool> CheckPodAliveAsync(string podName);
        Task<List<PodInfo>> GetPodsByLabelAsync(string label = "ctf/kind=challenge");
        Task<bool> DeleteNamespaceAsync(string namespaceName);
        Task<int?> GetNodePortAsync(string namespaceName);
        Task<ChallengeDeployResponeDTO?> HandleChallengeRunningAsync(int challengeId, int teamId, string podName, DeploymentInfo deploymentCache);

        Task<WorkflowPhase> GetWorkflowStatusAsync(string wfName, string namespaceName = "argo");
    }
    public class K8sService : IK8sService
    {
        private readonly IKubernetes _kubernetes;
        private readonly RedisHelper _redisHelper;
        private readonly AppDbContext _dbContext;
        public K8sService(RedisHelper redisHelper, AppDbContext dbContext)
        {
            _redisHelper = redisHelper;
            try
            {
                var config = KubernetesClientConfiguration.InClusterConfig();
                _kubernetes = new Kubernetes(config);

                var version = _kubernetes.Version.GetCode();
                Console.WriteLine($"[K8sService] Connected to K8s API v{version.Major}.{version.Minor}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[K8sService] Failed to connect: {ex.Message}");
            }

            _dbContext=dbContext;
        }

        public async Task<bool> CheckPodAliveAsync(string podName, string namespaceName)
        {
            try
            {
                // var pod = await _kubernetes.CoreV1.ReadNamespacedPodAsync(podName,namespaceName);

                var pods = await _kubernetes.CoreV1.ListNamespacedPodAsync(namespaceName);

                var pod = pods.Items
                    .Where(p => p.Metadata.Name.StartsWith(podName))
                    .OrderByDescending(p => p.Metadata.CreationTimestamp)
                    .FirstOrDefault();

                if (pod == null)
                {
                    await Console.Error.WriteLineAsync($"[K8sService] No pod found with prefix: {podName}");
                    return false;
                }

                await Console.Out.WriteLineAsync($"[K8sService] Found pod: {JsonSerializer.Serialize(pod)}");

                var phase = pod.Status?.Phase ?? "Unknown";
                var ready = pod.Status.Conditions?.Any(c => c.Type == "Ready" && c.Status == "True") == true;

                await Console.Out.WriteLineAsync($"[K8sService] Pod: {podName}, Phase={phase}, Ready={ready}");
                if(phase == "Running" && ready)
                {
                    return true;
                }
                else
                {
                    var log = await _kubernetes.CoreV1.ReadNamespacedPodLogAsync(pod.Metadata.Name, namespaceName);
                    await Console.Error.WriteLineAsync($"[K8sService] Pod Logs:\n{log}");
                    return false;
                }

            }
            catch (k8s.Autorest.HttpOperationException ex)
            {
                if (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    await Console.Error.WriteLineAsync($"[K8sService] Pod not found: {podName}");
                    return false;
                }
                await Console.Error.WriteLineAsync($"[K8sService] API Error: {ex.Response.ReasonPhrase}");
                return false;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[K8sService] Exception checking pod {podName}: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> CheckPodAliveAsync(string podName)
        {
            try
            {
                var pods = await _redisHelper.GetFromCacheAsync<List<PodInfo>>(RedisConfigs.PodsInfoKey);

                if (pods == null)
                {
                    await Console.Out.WriteLineAsync($"[K8sService] No pod info found in cache.");
                    return false;
                }

                var podInfo = pods.FirstOrDefault(p => p.Name.StartsWith(podName));
                if (podInfo != null) {
                    await Console.Out.WriteLineAsync($"[K8sService] Pod: {podName}, Status={podInfo.Status}, Ready={podInfo.Ready}");
                    return podInfo.Status == "Running" && podInfo.Ready;
                }
                await Console.Out.WriteLineAsync($"[K8sService] No pod info found in cache for prefix: {podName}");
                return false;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[K8sService] Exception checking pod {podName}: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> DeleteNamespaceAsync(string namespaceName)
        {
            await Console.Out.WriteLineAsync($"[K8sService] Deleting namespace: {namespaceName}");
            try
            {
                var result = await _kubernetes.CoreV1.DeleteNamespaceAsync(namespaceName);
                await Console.Out.WriteLineAsync($"[K8sService] Namespace '{namespaceName}' deletion requested. Status: {result.Status}");
                return true;
            }
            catch (k8s.Autorest.HttpOperationException ex)
            {
                await Console.Error.WriteLineAsync($"[K8sService] Failed to delete namespace '{namespaceName}': {ex.Response.Content}");
                return false;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[K8sService] Error deleting namespace '{namespaceName}': {ex.Message}");
                return false;
            }
        }

        public async Task<List<PodInfo>> GetPodsByLabelAsync(string label = "ctf/kind=challenge")
        {
            var result = new List<PodInfo>();

            try
            {
                var pods = await _kubernetes.CoreV1.ListPodForAllNamespacesAsync(labelSelector: label);

                foreach (var pod in pods.Items)
                {
                    var csList = pod.Status?.ContainerStatuses ?? new List<V1ContainerStatus>();

                    string status = pod.Status?.Phase ?? "Unknown";
                    foreach (var cs in csList)
                    {
                        if (cs.State?.Waiting != null)
                            status = cs.State.Waiting.Reason ?? "Waiting";
                        else if (cs.State?.Terminated != null)
                            status = cs.State.Terminated.Reason ?? "Terminated";
                        else if (cs.State?.Running != null)
                            status = "Running";
                    }

                    bool ready = csList.All(c => c.Ready);

                    string age = "";
                    if (pod.Status?.StartTime != null)
                    {
                        var diff = DateTime.UtcNow - pod.Status.StartTime.Value;
                        if (diff.TotalDays >= 1) age = $"{(int)diff.TotalDays}d";
                        else if (diff.TotalHours >= 1) age = $"{(int)diff.TotalHours}h";
                        else age = $"{(int)diff.TotalMinutes}m";
                    }

                    result.Add(new PodInfo
                    {
                        Namespace = pod.Metadata.NamespaceProperty ?? "",
                        Name = pod.Metadata.Name ?? "",
                        Ready = ready,
                        Status = status,
                        Age = age
                    });

                    if (status == "Running" && ready)
                    {
                        var (teamId, challengeId) = ChallengeHelper.ParseDeploymentAppName(pod.Metadata.NamespaceProperty ?? "");
                        var startedKey = ChallengeHelper.GetArgoWName(challengeId, teamId);
                        var deploymentCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(startedKey);

                        await HandleChallengeRunningAsync(challengeId, teamId, deploymentCache.PodName, deploymentCache);
                    }
                }

                await  Console.Out.WriteLineAsync($"[K8sService] Found {result.Count} challenge pods: {JsonSerializer.Serialize(result)}");
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[K8sService] Error listing challenge pods: {ex.Message}");
            }

            return result;
        }

        public async Task<int?> GetNodePortAsync(string namespaceName)
        {
            try
            {
                var svcs = await _kubernetes.CoreV1.ListNamespacedServiceAsync(namespaceName);

                var svc = svcs.Items.FirstOrDefault();
                if (svc == null)
                {
                    await Console.Out.WriteLineAsync($"[WARN] Namespace '{namespaceName}' not have any service.");
                    return null;
                }

                if (svc.Spec.Type != "NodePort")
                {
                    await Console.Out.WriteLineAsync($"[WARN] Service '{svc.Metadata.Name}' not a NodePort type.");
                    return null;
                }

                var nodePort = svc.Spec.Ports.FirstOrDefault()?.NodePort;

               await Console.Out.WriteLineAsync($"[INFO] Namespace '{namespaceName}' NodePort = {nodePort}");
                return nodePort;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[ERROR] Unable to get NodePort in namespace '{namespaceName}': {ex.Message}");
                return null;
            }
        }

        public async Task<ChallengeDeployResponeDTO?> HandleChallengeRunningAsync(int challengeId,int teamId,string podName, DeploymentInfo deploymentCache)
        {
            try
            {

                var challenge = _dbContext.Challenges.FirstOrDefault(c => c.Id == challengeId);
                if (challenge == null)
                    return new ChallengeDeployResponeDTO
                    {
                        success = false,
                        message = "Challenge not found.",
                        status = (int)HttpStatusCode.NotFound
                    };

                var timeFinished = DateTime.Now.AddMinutes(challenge.TimeLimit ?? -1);
                var cacheExpired = challenge.TimeLimit != null && challenge.TimeLimit > 0
                    ? TimeSpan.FromSeconds(challenge.TimeLimit.Value * 60)
                    : (TimeSpan?)null;

                // Lấy port và domain
                var port = await GetNodePortAsync(podName);
                var challengeDomain = $"Host: challenge-zg9uj3rfagfja19tzq.fctf.cloud {port}";

                // Cập nhật DeploymentInfo
                deploymentCache.Status = DeploymentStatus.RUNING;
                deploymentCache.DeploymentDomainName = challengeDomain;
                deploymentCache.EndTime = timeFinished;

                var startedKey = ChallengeHelper.GetArgoWName(challengeId, teamId);
                await _redisHelper.SetCacheAsync(startedKey, deploymentCache, cacheExpired);

                // Cập nhật ChallengeDeploymentCacheDTO
                var chalDeployKey = ChallengeHelper.GetCacheKey(challengeId, teamId);
                var chalDeploy = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(chalDeployKey);
                if (chalDeploy != null)
                {
                    chalDeploy.status = DeploymentStatus.RUNING;
                    chalDeploy.challenge_url = challengeDomain;
                    chalDeploy.time_finished = new DateTimeOffset(timeFinished).ToUnixTimeSeconds();
                    await _redisHelper.SetCacheAsync(chalDeployKey, chalDeploy, cacheExpired);
                }

                return new ChallengeDeployResponeDTO
                {
                    success = true,
                    message = "Challenge is running.",
                    status = (int)HttpStatusCode.OK,
                    challenge_url = challengeDomain,
                    time_limit = challenge.TimeLimit ?? -1
                };

            }
            catch (Exception ex)
            { 
                await Console.Error.WriteLineAsync($"[K8sService - Handle Challenge Running] Error handling challenge running: {ex.Message}");
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Internal server error.",
                    status = (int)HttpStatusCode.InternalServerError
                };
            }
        }

        public async Task<WorkflowPhase> GetWorkflowStatusAsync(string wfName, string namespaceName = "argo")
        {
            try
            {
                var wf = await _kubernetes.CustomObjects.GetNamespacedCustomObjectAsync(
                    group: "argoproj.io",
                    version: "v1alpha1",
                    namespaceParameter: namespaceName,
                    plural: "workflows",
                    name: wfName
                );

                // Parse JSON để lấy status.phase
                var json = JsonSerializer.Serialize(wf);
                using var doc = JsonDocument.Parse(json);

                if (doc.RootElement.TryGetProperty("status", out var statusElem) &&
                    statusElem.TryGetProperty("phase", out var phaseElem))
                {
                    var phaseStr = phaseElem.GetString();

                    if (Enum.TryParse(phaseStr, true, out WorkflowPhase phase))
                    {
                        Console.WriteLine($"[K8sService] Workflow {wfName} status: {phase}");
                        return phase;
                    }

                    Console.WriteLine($"[K8sService] Unknown workflow phase: {phaseStr}");
                    return WorkflowPhase.Unknown;
                }

                return WorkflowPhase.Unknown;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[K8sService] ❌ Error while getting workflow status: {ex.Message}");
                return WorkflowPhase.Unknown;
            }
        }
    }
}

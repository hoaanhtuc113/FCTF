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
using System.Xml.Linq;
using static ResourceShared.Enums;
using File = System.IO.File;

namespace ResourceShared.Services
{
    public interface IK8sService
    {
        Task<bool> CheckPodAlive(string podName, string namespaceName);
        Task<bool> CheckPodAliveInCache(string podName);
        Task<List<PodInfo>> GetPodsByLabel(string label = "ctf/kind=challenge");
        Task<bool> DeleteNamespace(string namespaceName);
        Task<int?> GetNodePort(string namespaceName);
        Task<ChallengeDeployResponeDTO?> HandleChallengeRunning(int challengeId, int teamId, string podName, DeploymentInfo deploymentCache);

        Task<WorkflowPhase> GetWorkflowStatus(string wfName, string namespaceName = "argo");
        Task<string> GetWorkflowLogs(string workflowName, string namespaceName = "argo");
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
            }
            catch (Exception ex)
            {
                var kubeConfigPath = Environment.GetEnvironmentVariable("KUBECONFIG") ?? "/root/.kube/config";
                if (!File.Exists(kubeConfigPath))
                    throw new FileNotFoundException($"Không tìm thấy kubeconfig tại {kubeConfigPath}");

                var config = KubernetesClientConfiguration.BuildConfigFromConfigFile(kubeConfigPath);
                _kubernetes = new Kubernetes(config);

                var version = _kubernetes.Version.GetCode();
                Console.WriteLine($"[K8sService] Try to local kubeconfig: Connected to K8s API v{version.Major}.{version.Minor}");
            }

            _dbContext=dbContext;
        }

        public async Task<bool> CheckPodAlive(string podName, string namespaceName)
        {
            try
            {
                // var pod = await _kubernetes.CoreV1.ReadNamespacedPodAsync(podName,namespaceName);

                var pods = await _kubernetes.CoreV1.ListNamespacedPodAsync(
                    namespaceParameter: namespaceName,
                    fieldSelector: $"metadata.name={podName}"
                );

                var pod = pods.Items.FirstOrDefault();

                if (pod == null)
                {
                    await Console.Error.WriteLineAsync($"[Check Pod Alive] No pod found with prefix: {podName}");
                    return false;
                }

                await Console.Out.WriteLineAsync($"[Check Pod Alive] Found pod: {JsonSerializer.Serialize(pod)}");

                var phase = pod.Status?.Phase ?? "Unknown";
                var ready = pod.Status.Conditions?.Any(c => c.Type == "Ready" && c.Status == "True") == true;

                await Console.Out.WriteLineAsync($"[Check Pod Alive] Pod: {podName}, Phase={phase}, Ready={ready}");
                if (phase == "Running" && ready) return true;

                var log = await _kubernetes.CoreV1.ReadNamespacedPodLogAsync(pod.Metadata.Name, namespaceName);
                await Console.Error.WriteLineAsync($"[Check Pod Alive] Pod Logs:\n{log}");
                return false;
            }
            catch (k8s.Autorest.HttpOperationException ex)
            {
                if (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    await Console.Error.WriteLineAsync($"[Check Pod Alive] Pod not found: {podName}");
                    return false;
                }
                await Console.Error.WriteLineAsync($"[Check Pod Alive] API Error: {ex.Response.ReasonPhrase}");
                return false;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[Check Pod Alive] Exception checking pod {podName}: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> CheckPodAliveInCache(string podName)
        {
            try
            {
                var pods = await _redisHelper.GetFromCacheAsync<List<PodInfo>>(RedisConfigs.PodsInfoKey);

                if (pods == null)
                {
                    await Console.Out.WriteLineAsync($"[Check Pod Alive] No pod info found in cache.");
                    return false;
                }

                var podInfo = pods.FirstOrDefault(p => p.Name.StartsWith(podName));
                if (podInfo != null) {
                    await Console.Out.WriteLineAsync($"[Check Pod Alive] Pod: {podName}, Status={podInfo.Status}, Ready={podInfo.Ready}");
                    return podInfo.Status == "Running" && podInfo.Ready;
                }
                await Console.Out.WriteLineAsync($"[Check Pod Alive] No pod info found in cache for prefix: {podName}");
                return false;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[Check Pod Alive] Exception checking pod {podName}: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> DeleteNamespace(string namespaceName)
        {
            await Console.Out.WriteLineAsync($"[Delete Namespace] Deleting namespace: {namespaceName}");
            try
            {
                var result = await _kubernetes.CoreV1.DeleteNamespaceAsync(namespaceName);
                await Console.Out.WriteLineAsync($"[Delete Namespace] Namespace '{namespaceName}' deletion requested. Status: {result.Status}");
                return true;
            }
            catch (k8s.Autorest.HttpOperationException ex)
            {
                await Console.Error.WriteLineAsync($"[Delete Namespace] Failed to delete namespace '{namespaceName}': {ex.Response.Content}");
                return false;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[Delete Namespace] Error deleting namespace '{namespaceName}': {ex.Message}");
                return false;
            }
        }

        public async Task<List<PodInfo>> GetPodsByLabel(string label = "ctf/kind=challenge")
        {
            var result = new List<PodInfo>();

            try
            {
                var pods = await _kubernetes.CoreV1.ListPodForAllNamespacesAsync(labelSelector: label);

                foreach (var pod in pods.Items)
                {
                    var csList = pod.Status?.ContainerStatuses ?? new List<V1ContainerStatus>();
                    var name = pod.Metadata?.Name ?? "unknown";
                    var ns = pod.Metadata?.NamespaceProperty ?? "unknown";
                    var status = pod.Status?.Phase ?? "Unknown";
                    var ready = csList.All(c => c.Ready);

                    foreach (var cs in csList)
                    {
                        if (cs.State?.Waiting != null)
                            status = cs.State.Waiting.Reason ?? "Waiting";
                        else if (cs.State?.Terminated != null)
                            status = cs.State.Terminated.Reason ?? "Terminated";
                        else if (cs.State?.Running != null)
                            status = "Running";
                    }


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
                        Namespace = ns,
                        Name = name,
                        Ready = ready,
                        Status = status,
                        Age = age
                    });

                    await Console.Out.WriteLineAsync($"[GetPods] {ns}/{name} → {status} (Ready={ready})");

                    if (status == "Running" && ready && !string.IsNullOrEmpty(ns))
                    {
                        try
                        {
                            var (teamId, challengeId) = ChallengeHelper.ParseDeploymentAppName(ns);
                            var startedKey = ChallengeHelper.GetArgoWName(challengeId, teamId);
                            var deploymentCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(startedKey);

                            if (deploymentCache != null)
                                await HandleChallengeRunning(challengeId, teamId, deploymentCache.NameSpace, deploymentCache);
                        }
                        catch (Exception ex)
                        {
                            await Console.Error.WriteLineAsync($"[Get Pods By Label] Parse or handle error for {ns}: {ex.Message}");
                        }
                    }
                }

                await  Console.Out.WriteLineAsync($"[Get Pods By Label] Found {result.Count} challenge pods: {JsonSerializer.Serialize(result)}");
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[Get Pods By Label] Error listing challenge pods: {ex.Message}");
            }

            return result;
        }

        public async Task<int?> GetNodePort(string namespaceName)
        {
            try
            {
                var svcs = await _kubernetes.CoreV1.ListNamespacedServiceAsync(namespaceName);

                var svc = svcs.Items.FirstOrDefault();
                if (svc == null)
                {
                    await Console.Out.WriteLineAsync($"[Get Node Port] Namespace '{namespaceName}' not have any service.");
                    return null;
                }

                var portSpec = svc.Spec.Ports?.FirstOrDefault();
                if (portSpec?.NodePort == null)
                {
                    await Console.Out.WriteLineAsync($"[Get Node Port] Service '{svc.Metadata?.Name}' has no NodePort assigned.");
                    return null;
                }
                if (svc.Spec.Type != "NodePort")
                {
                    await Console.Out.WriteLineAsync($"[Get Node Port] Service '{svc.Metadata.Name}' not a NodePort type.");
                    return null;
                }

                var nodePort = portSpec.NodePort;
                await Console.Out.WriteLineAsync($"[Get Node Port] Namespace '{namespaceName}' NodePort = {nodePort}");
                return nodePort;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[Get Node Port] Unable to get NodePort in namespace '{namespaceName}': {ex.Message}");
                return null;
            }
        }

        public async Task<ChallengeDeployResponeDTO?> HandleChallengeRunning(int challengeId,int teamId,string podName, DeploymentInfo deploymentCache)
        {
            try
            {

                var challenge =  await _dbContext.Challenges.FirstOrDefaultAsync(c => c.Id == challengeId);
                if (challenge == null)
                    return new ChallengeDeployResponeDTO
                    {
                        success = false,
                        message = "Challenge not found.",
                        status = (int)HttpStatusCode.NotFound
                    };

                var timeLimit = challenge.TimeLimit ?? -1;
                var timeFinished = DateTime.Now.AddMinutes(timeLimit);
                var cacheExpired = timeLimit > 0 ? TimeSpan.FromMinutes(timeLimit) : (TimeSpan?)null;

                // Lấy port và domain
                var port = await GetNodePort(podName);
                if (port == null)
                    return new ChallengeDeployResponeDTO
                    {
                        success = false,
                        message = "Pod NodePort not ready.",
                        status = (int)HttpStatusCode.BadRequest
                    };

                var challengeDomain = $"Host: challenge-zg9uj3rfagfja19tzq.fctf.cloud {port}";

                // Cập nhật DeploymentInfo
                deploymentCache.Status = DeploymentStatus.RUNING;
                deploymentCache.DeploymentDomainName = challengeDomain;
                deploymentCache.DeploymentPort = port.Value;
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

        public async Task<WorkflowPhase> GetWorkflowStatus(string wfName, string namespaceName = "argo")
        {
            try
            {
                var wfObj = await _kubernetes.CustomObjects.GetNamespacedCustomObjectAsync(
                    group: "argoproj.io",
                    version: "v1alpha1",
                    namespaceParameter: namespaceName,
                    plural: "workflows",
                    name: wfName
                );

                // Convert sang JsonElement thay vì serialize lại để tiết kiệm tài nguyên
                if (wfObj is JsonElement wfElement &&
                    wfElement.TryGetProperty("status", out var statusElem) &&
                    statusElem.TryGetProperty("phase", out var phaseElem))
                {
                    var phaseStr = phaseElem.GetString();
                    if (!string.IsNullOrEmpty(phaseStr) &&
                        Enum.TryParse(phaseStr, true, out WorkflowPhase phase))
                    {
                        Console.WriteLine($"[K8sService] Workflow {wfName} phase: {phase}");
                        return phase;
                    }

                    Console.WriteLine($"[K8sService] Unknown workflow phase value: {phaseStr}");
                    return WorkflowPhase.Unknown;
                }

                Console.WriteLine($"[K8sService] Workflow {wfName} has no status.phase field.");
                return WorkflowPhase.Unknown;
            }
            catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == HttpStatusCode.NotFound)
            {
                Console.WriteLine($"[K8sService] Workflow {wfName} not found in namespace {namespaceName}");
                return WorkflowPhase.Unknown;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[K8sService] Error while getting workflow status for {wfName}: {ex.Message}");
                return WorkflowPhase.Unknown;
            }
        }


        public async Task<string> GetWorkflowLogs(string workflowName, string namespaceName = "argo")
        {
            var sb = new StringBuilder();

            // Lấy danh sách pods trong workflow
            var pods = await _kubernetes.CoreV1.ListNamespacedPodAsync(
                namespaceParameter: namespaceName,
                labelSelector: $"workflows.argoproj.io/workflow={workflowName}"
            );

            foreach (var pod in pods.Items)
            {
                sb.AppendLine($"=== Pod: {pod.Metadata.Name} ===");

                //Mở stream log realtime
                using var stream = await _kubernetes.CoreV1.ReadNamespacedPodLogAsync(
                    name: pod.Metadata.Name,
                    namespaceParameter: namespaceName,
                    follow: true 
                );

                using var reader = new StreamReader(stream);
                while (!reader.EndOfStream)
                {
                    var line = await reader.ReadLineAsync();
                    if (!string.IsNullOrWhiteSpace(line))
                    {
                        sb.AppendLine(line);
                    }
                }

                sb.AppendLine();
            }
            return sb.ToString();
        }
    }
}

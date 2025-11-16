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
using System.Text.RegularExpressions;
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
        Task<(int successCount, int failCount, List<string> errors)> DeleteAllChallengeNamespaces(string labelSelector = "ctf/kind=challenge");
        Task<int?> GetNodePort(string namespaceName);
        Task<ChallengeDeployResponeDTO?> HandleChallengeRunning(int challengeId, int teamId, string podName, ChallengeDeploymentCacheDTO deploymentCache);
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
                if (phase == DeploymentStatus.RUNING && ready) return true;

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

        public async Task<(int successCount, int failCount, List<string> errors)> DeleteAllChallengeNamespaces(string labelSelector = "ctf/kind=challenge")
        {
            await Console.Out.WriteLineAsync($"[Delete All Namespaces] Deleting all namespaces with label: {labelSelector}");
            
            int successCount = 0;
            int failCount = 0;
            var errors = new List<string>();

            try
            {
                // List all namespaces with the specified label
                var namespaces = await _kubernetes.CoreV1.ListNamespaceAsync(labelSelector: labelSelector);
                
                if (namespaces.Items.Count == 0)
                {
                    await Console.Out.WriteLineAsync("[Delete All Namespaces] No namespaces found with the specified label.");
                    return (0, 0, errors);
                }

                await Console.Out.WriteLineAsync($"[Delete All Namespaces] Found {namespaces.Items.Count} namespaces to delete.");

                // Delete each namespace
                foreach (var ns in namespaces.Items)
                {
                    var namespaceName = ns.Metadata.Name;
                    try
                    {
                        await Console.Out.WriteLineAsync($"[Delete All Namespaces] Deleting namespace: {namespaceName}");
                        await _kubernetes.CoreV1.DeleteNamespaceAsync(namespaceName);
                        successCount++;
                        await Console.Out.WriteLineAsync($"[Delete All Namespaces] Successfully deleted namespace: {namespaceName}");
                    }
                    catch (k8s.Autorest.HttpOperationException ex)
                    {
                        failCount++;
                        var error = $"Failed to delete namespace '{namespaceName}': {ex.Response.Content}";
                        errors.Add(error);
                        await Console.Error.WriteLineAsync($"[Delete All Namespaces] {error}");
                    }
                    catch (Exception ex)
                    {
                        failCount++;
                        var error = $"Error deleting namespace '{namespaceName}': {ex.Message}";
                        errors.Add(error);
                        await Console.Error.WriteLineAsync($"[Delete All Namespaces] {error}");
                    }
                }

                await Console.Out.WriteLineAsync($"[Delete All Namespaces] Completed. Success: {successCount}, Failed: {failCount}");
                return (successCount, failCount, errors);
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[Delete All Namespaces] Critical error: {ex.Message}");
                errors.Add($"Critical error while listing namespaces: {ex.Message}");
                return (successCount, failCount, errors);
            }
        }

        public async Task<List<PodInfo>> GetPodsByLabel(string label = "ctf/kind=challenge")
        {
            var podsResult = new List<PodInfo>();

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
                            status = cs.State.Waiting.Reason ?? DeploymentReason.WAITING;
                        else if (cs.State?.Terminated != null)
                            status = cs.State.Terminated.Reason ?? DeploymentReason.TERMINATED;
                        else if (cs.State?.Running != null)
                            status = DeploymentStatus.RUNING;
                    }

                    string age = "";
                    if (pod.Status?.StartTime != null)
                    {
                        var diff = DateTime.UtcNow - pod.Status.StartTime.Value;
                        if (diff.TotalDays >= 1) age = $"{(int)diff.TotalDays}d";
                        else if (diff.TotalHours >= 1) age = $"{(int)diff.TotalHours}h";
                        else age = $"{(int)diff.TotalMinutes}m";
                    }

                    var (teamId, challengeId) = ChallengeHelper.ParseDeploymentAppName(ns);

                    var isStuck = IsPodStuck(pod);
                    if (isStuck)
                    {
                        await Console.Out.WriteLineAsync($"[STUCK] Pod {name} in Namespace {ns} is stuck with status '{status}'. Attempting to delete namespace.");

                        var deleted = await DeleteNamespace(ns);

                        if (deleted)
                        {
                            await _redisHelper.RemoveCacheAsync(ChallengeHelper.GetCacheKey(challengeId, teamId));

                            await Console.Out.WriteLineAsync($"[STUCK] Cleared Redis for team={teamId}, challenge={challengeId}");
                        }

                        continue;
                    }

                    podsResult.Add(new PodInfo
                    {
                        Namespace = ns,
                        TeamId = teamId,
                        ChallengeId = challengeId,
                        Name = name,
                        Ready = ready,
                        Status = status,
                        Age = age,
                        IsPending = false
                    });

                    if (status == DeploymentStatus.RUNING && ready)
                    {
                        var deploymentKey = ChallengeHelper.GetCacheKey(challengeId, teamId);
                        var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);

                        if (deploymentCache != null)
                            await HandleChallengeRunning(challengeId, teamId, deploymentCache._namespace, deploymentCache);
                    }
                }
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[GetPodsByLabel] Error: {ex.Message}");
            }

            return podsResult; 
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

        public async Task<ChallengeDeployResponeDTO?> HandleChallengeRunning(int challengeId,int teamId,string podName, ChallengeDeploymentCacheDTO deploymentCache)
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

                // Lấy port và domain
                var port = await GetNodePort(podName);
                if (port == null)
                    return new ChallengeDeployResponeDTO
                    {
                        success = false,
                        message = "Pod NodePort not ready.",
                        status = (int)HttpStatusCode.BadRequest
                    };

                var challengeDomain = $"Host: {SharedConfig.TCP_DOMAIN} {port}";

                var timeLimit = challenge.TimeLimit ?? -1;
                //var timeFinished = DateTimeOffset.UtcNow.AddMinutes(timeLimit).UtcDateTime;
                //var cacheExpired = timeLimit > 0 ? TimeSpan.FromMinutes(timeLimit) : (TimeSpan?)null;
                var nowUtc = DateTimeOffset.UtcNow;
                var timeFinished = nowUtc.AddMinutes(timeLimit);
                var cacheExpired = timeLimit > 0
                    ? TimeSpan.FromMinutes(timeLimit)
                    : (TimeSpan?)null;

                // Set đúng cho các lần loop sau, không đổi time finished nếu đã có và còn hiệu lực
                if (deploymentCache.time_finished > nowUtc.ToUnixTimeSeconds())
                {
                    timeFinished = DateTimeOffset.FromUnixTimeSeconds(deploymentCache.time_finished);
                    cacheExpired = timeFinished - nowUtc;
                }

                var chalDeployKey = ChallengeHelper.GetCacheKey(challengeId, teamId);

                if (deploymentCache != null)
                {
                    deploymentCache.status = DeploymentStatus.RUNING;
                    deploymentCache.challenge_url = challengeDomain;
                    deploymentCache.time_finished =  timeFinished.ToUnixTimeSeconds();
                    await _redisHelper.SetCacheAsync(chalDeployKey, deploymentCache, cacheExpired);
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

            var ansiRegex = new Regex(@"\x1B\[[0-9;]*[A-Za-z]");

            // Lấy tất cả pod thuộc workflow
            var pods = await _kubernetes.CoreV1.ListNamespacedPodAsync(
                namespaceParameter: namespaceName,
                labelSelector: $"workflows.argoproj.io/workflow={workflowName}"
            );

            // Chỉ lấy pod có tên chứa "build-and-push"
            var targetPods = pods.Items
                .Where(p => p.Metadata?.Name != null && p.Metadata.Name.Contains("build-and-push"))
                .ToList();

            if (!targetPods.Any())
                return $"[No build-and-push pod found in workflow {workflowName}]";

            foreach (var pod in targetPods)
            {
                sb.AppendLine("==============================");
                sb.AppendLine($"Pod: {pod.Metadata.Name}");
                sb.AppendLine("==============================");

                // Lấy danh sách container (init + chính)
                var containerNames = new List<string>();
                if (pod.Spec.InitContainers != null)
                    containerNames.AddRange(pod.Spec.InitContainers.Select(c => c.Name));
                if (pod.Spec.Containers != null)
                    containerNames.AddRange(pod.Spec.Containers.Select(c => c.Name));

                foreach (var containerName in containerNames)
                {
                    sb.AppendLine($"--- Container: {containerName} ---");

                    try
                    {
                        using var stream = await _kubernetes.CoreV1.ReadNamespacedPodLogAsync(
                            name: pod.Metadata.Name,
                            namespaceParameter: namespaceName,
                            container: containerName,
                            follow: false,
                            cancellationToken: CancellationToken.None
                        );

                        using var reader = new StreamReader(stream);
                        var logText = await reader.ReadToEndAsync();

                        if (!string.IsNullOrWhiteSpace(logText))
                        {
                            var cleanText = ansiRegex.Replace(logText, string.Empty);
                            sb.AppendLine(cleanText.TrimEnd());
                        }
                        else
                        {
                            sb.AppendLine("[no logs]");
                        }
                    }
                    catch (Exception ex)
                    {
                        sb.AppendLine($"[Get Workflow Logs] Error reading logs from container {containerName}: {ex.Message}");
                    }

                    sb.AppendLine();
                }

                sb.AppendLine();
            }
            return sb.ToString();
        }


        private bool IsPodStuck(V1Pod pod)
        {
            var cs = pod.Status?.ContainerStatuses?.FirstOrDefault();
            var reason = "";
            var ageMinutes = 0;

            if (pod.Status?.StartTime != null)
                ageMinutes = (int)(DateTime.UtcNow - pod.Status.StartTime.Value).TotalMinutes;

            if (cs != null)
            {
                if (cs.State?.Waiting != null)
                    reason = cs.State.Waiting.Reason ?? DeploymentReason.WAITING;

                if (cs.State?.Terminated != null)
                    reason = cs.State.Terminated.Reason ?? DeploymentReason.TERMINATED;
            }

            var restartCount = cs?.RestartCount ?? 0;
            var phase = pod.Status?.Phase ?? "Unknown";

            // Pod phase failed
            if (phase == DeploymentStatus.FAILED)
                return true;

            // Critical reasons that never recover
            string[] fatalReasons = new[]
            {
                DeploymentReason.IMAGE_PULL_BACK_OFF, DeploymentReason.ERR_IMAGE_PULL, DeploymentReason.INVALID_IMAGE_NAME,
                DeploymentReason.CREATE_CONTAINER_CONFIG_ERROR, DeploymentReason.CREATE_CONTAINER_ERROR
            };
            if (fatalReasons.Contains(reason))
                return true;

            // CrashLoopBackOff nhiều lần
            if (reason == DeploymentReason.CRASH_LOOP_BACK_OFF && restartCount > 2)
                return true;

            // OOMKilled nhiều lần
            if (reason == DeploymentReason.OOM_KILLED && restartCount > 2)
                return true;

            // ContainerCreating quá lâu
            if (reason == DeploymentReason.CONTAINER_CREATING && ageMinutes > 5)
                return true;

            // Running nhưng không ready > 2 phút (nếu không có container status thì coi như not ready)
            if (phase == DeploymentStatus.RUNING && !(cs?.Ready ?? false) && ageMinutes > 2)
                return true;

            return false;
        }

    }
}

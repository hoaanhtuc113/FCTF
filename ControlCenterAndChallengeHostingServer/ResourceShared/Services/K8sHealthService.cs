using k8s;
using k8s.Models;
using ResourceShared.Configs;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Models;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace ResourceShared.Services
{
    public interface IK8sHealthService
    {
        Task<bool> CheckPodAliveAsync(string podName, string namespaceName);
        Task<bool> CheckPodAliveAsync(string podName);
        Task<List<PodInfo>> GetPodsByLabelAsync(string label = "ctf/kind=challenge");
        Task<bool> DeleteNamespaceAsync(string namespaceName);
    }
    public class K8sHealthService : IK8sHealthService
    {
        private readonly IKubernetes _kubernetes;
        private readonly RedisHelper _redisHelper;
        public K8sHealthService(RedisHelper redisHelper)
        {
            _redisHelper = redisHelper;
            try
            {
                var config = KubernetesClientConfiguration.InClusterConfig();
                _kubernetes = new Kubernetes(config);

                var version = _kubernetes.Version.GetCode();
                Console.WriteLine($"[K8sHealthService] Connected to K8s API v{version.Major}.{version.Minor}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[K8sHealthService] Failed to connect: {ex.Message}");
            }
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
                    await Console.Error.WriteLineAsync($"[K8sHealthService] No pod found with prefix: {podName}");
                    return false;
                }

                await Console.Out.WriteLineAsync($"[K8sHealthService] Found pod: {JsonSerializer.Serialize(pod)}");

                var phase = pod.Status?.Phase ?? "Unknown";
                var ready = pod.Status.Conditions?.Any(c => c.Type == "Ready" && c.Status == "True") == true;

                await Console.Out.WriteLineAsync($"[K8sHealthService] Pod: {podName}, Phase={phase}, Ready={ready}");
                if(phase == "Running" && ready)
                {
                    return true;
                }
                else
                {
                    var log = await _kubernetes.CoreV1.ReadNamespacedPodLogAsync(pod.Metadata.Name, namespaceName);
                    await Console.Error.WriteLineAsync($"[K8sHealthService] Pod Logs:\n{log}");
                    return false;
                }

            }
            catch (k8s.Autorest.HttpOperationException ex)
            {
                if (ex.Response.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    await Console.Error.WriteLineAsync($"[K8sHealthService] Pod not found: {podName}");
                    return false;
                }
                await Console.Error.WriteLineAsync($"[K8sHealthService] API Error: {ex.Response.ReasonPhrase}");
                return false;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[K8sHealthService] Exception checking pod {podName}: {ex.Message}");
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
                    await Console.Out.WriteLineAsync($"[K8sHealthService] No pod info found in cache.");
                    return false;
                }

                var podInfo = pods.FirstOrDefault(p => p.Name.StartsWith(podName));
                if (podInfo != null) {
                    await Console.Out.WriteLineAsync($"[K8sHealthService] Pod: {podName}, Status={podInfo.Status}, Ready={podInfo.Ready}");
                    return podInfo.Status == "Running" && podInfo.Ready;
                }
                await Console.Out.WriteLineAsync($"[K8sHealthService] No pod info found in cache for prefix: {podName}");
                return false;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[K8sHealthService] Exception checking pod {podName}: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> DeleteNamespaceAsync(string namespaceName)
        {
            try
            {
                var result = await _kubernetes.CoreV1.DeleteNamespaceAsync(namespaceName);
                await Console.Out.WriteLineAsync($"[K8sHealthService] Namespace '{namespaceName}' deletion requested. Status: {result.Status}");
                return true;
            }
            catch (k8s.Autorest.HttpOperationException ex)
            {
                await Console.Error.WriteLineAsync($"[K8sHealthService] Failed to delete namespace '{namespaceName}': {ex.Response.Content}");
                return false;
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[K8sHealthService] Error deleting namespace '{namespaceName}': {ex.Message}");
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
                }

                await  Console.Out.WriteLineAsync($"[K8sHealthService] Found {result.Count} challenge pods: {JsonSerializer.Serialize(result)}");
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[K8sHealthService] Error listing challenge pods: {ex.Message}");
            }

            return result;
        }
    }
}

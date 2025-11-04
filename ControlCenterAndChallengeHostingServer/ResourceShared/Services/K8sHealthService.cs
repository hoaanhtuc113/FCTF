using k8s;
using ResourceShared.Configs;
using ResourceShared.Models;
using System;
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
    }
    public class K8sHealthService : IK8sHealthService
    {
        private readonly IKubernetes _kubernetes;
        public K8sHealthService()
        {
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
    }
}

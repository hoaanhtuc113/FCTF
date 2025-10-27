using k8s;
using ResourceShared.Configs;
using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
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
            var useLocal = K8sConfigs.USE_LOCAL_K8S?.ToLower() == "true";

            var config = useLocal
                ? KubernetesClientConfiguration.BuildConfigFromConfigFile(
                    string.IsNullOrWhiteSpace(K8sConfigs.KUBE_CONFIG_PATH)
                        ? null
                        : K8sConfigs.KUBE_CONFIG_PATH)
                : KubernetesClientConfiguration.InClusterConfig();

            _kubernetes = new Kubernetes(config);
        }

        public async Task<bool> CheckPodAliveAsync(string podName, string namespaceName)
        {
            try
            {
                var pod = await _kubernetes.CoreV1.ReadNamespacedPodAsync(podName,namespaceName);

                var phase = pod.Status.Phase;
                var ready = pod.Status.Conditions?.Any(c => c.Type == "Ready" && c.Status == "True") == true;

                await Console.Out.WriteLineAsync($"[K8sHealthService] Pod: {podName}, Phase={phase}, Ready={ready}");
                return phase == "Running" && ready;
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

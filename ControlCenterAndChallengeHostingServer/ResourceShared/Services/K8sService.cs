using k8s;
using k8s.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using static ResourceShared.Enums;

namespace ResourceShared.Services;

public interface IK8sService
{
    Task<List<PodInfo>> GetPodsByLabel(
        string label = "ctf/kind=challenge",
        K8sService.PodEventHandler? _event = null);

    Task<bool> DeleteNamespace(string namespaceName);

    Task<(int successCount, int failCount, List<string> errors)> DeleteAllChallengeNamespaces(
        string labelSelector = "ctf/kind=challenge");

    Task<ChallengeDeployResponeDTO?> HandleChallengeRunning(
        int challengeId,
        int teamId,
        string podName,
        ChallengeDeploymentCacheDTO deploymentCache);

    Task<WorkflowPhase> GetWorkflowStatus(
        string wfName,
        string namespaceName = "argo");

    Task<string> GetWorkflowLogs(
        string workflowName,
        string namespaceName = "argo");

    Task<string> GetPodLogs(
        string namespaceName,
        string podName);

    bool IsPodStuck(V1Pod pod);
}
public class K8sService : IK8sService
{
    private readonly IKubernetes _kubernetes;
    private readonly RedisHelper _redisHelper;
    private readonly AppLogger _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    public delegate Task PodEventHandler(PodInfo pod);
    public K8sService(
        RedisHelper redisHelper,
        AppLogger logger,
        IKubernetes kubernetes,
        IServiceScopeFactory scopeFactory)
    {
        _redisHelper = redisHelper;
        _logger = logger;
        _kubernetes = kubernetes;
        _scopeFactory = scopeFactory;
    }

    public async Task<bool> DeleteNamespace(string namespaceName)
    {
        try
        {
            var result = await _kubernetes.CoreV1.DeleteNamespaceAsync(namespaceName);
            _logger.LogDebug("Namespace deletion requested", new { namespaceName, status = result.Status });
            return true;
        }
        catch (k8s.Autorest.HttpOperationException ex)
        {
            _logger.LogError(ex, data: new { namespaceName, responseContent = ex.Response.Content, errorType = "DeleteNamespaceHttpError" });
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, data: new { namespaceName, errorType = "DeleteNamespaceException" });
            return false;
        }
    }

    public async Task<(int successCount, int failCount, List<string> errors)> DeleteAllChallengeNamespaces(string labelSelector = "ctf/kind=challenge")
    {
        _logger.LogDebug("Deleting all namespaces with label", new { labelSelector });

        int successCount = 0;
        int failCount = 0;
        var errors = new List<string>();

        try
        {
            // List all namespaces with the specified label
            var namespaces = await _kubernetes.CoreV1.ListNamespaceAsync(labelSelector: labelSelector);

            if (namespaces.Items.Count == 0)
            {
                _logger.LogDebug("No namespaces found with the specified label", new { labelSelector });
                return (0, 0, errors);
            }

            _logger.LogDebug("Found namespaces to delete", new { count = namespaces.Items.Count, labelSelector });

            // Delete each namespace
            foreach (var ns in namespaces.Items)
            {
                var namespaceName = ns.Metadata.Name;
                try
                {
                    await _kubernetes.CoreV1.DeleteNamespaceAsync(namespaceName);
                    successCount++;
                    _logger.LogDebug("Successfully deleted namespace", new { namespaceName });
                }
                catch (k8s.Autorest.HttpOperationException ex)
                {
                    failCount++;
                    var error = $"Failed to delete namespace '{namespaceName}': {ex.Response.Content}";
                    errors.Add(error);
                    _logger.LogError(ex, data: new { namespaceName, responseContent = ex.Response.Content, errorType = "DeleteNamespaceHttpError" });
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, data: new { namespaceName, errorType = "DeleteNamespaceException" });
                    failCount++;
                    var error = $"Error deleting namespace '{namespaceName}': {ex.Message}";
                    errors.Add(error);
                }
            }

            _logger.LogDebug("Delete all namespaces completed", new { successCount, failCount, labelSelector });
            return (successCount, failCount, errors);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, data: new { labelSelector, errorType = "DeleteAllNamespacesCriticalError" });
            errors.Add($"Critical error while listing namespaces: {ex.Message}");
            return (successCount, failCount, errors);
        }
    }
    public async Task<List<PodInfo>> GetPodsByLabel(string label = "ctf/kind=challenge", PodEventHandler? _event = null)
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
                var deploymentKey = ChallengeHelper.GetCacheKey(challengeId, teamId);
                var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);
                if (isStuck)
                {

                    var deleted = false;
                    if (teamId > 0)
                    {
                        deleted = await DeleteNamespace(ns);
                    }

                    if (deleted)
                    {
                        await _redisHelper.RemoveCacheAsync(deploymentKey);


                        if (_event != null)
                        {
                            await _event(new PodInfo
                            {
                                Namespace = ns,
                                TeamId = teamId,
                                ChallengeId = challengeId,
                                //UserId = deploymentCache?.user_id ?? 0,
                                Name = name,
                                Ready = ready,
                                Status = status,
                                Age = age,
                                IsPending = true,
                            });
                        }
                    }
                    continue;
                }

                podsResult.Add(new PodInfo
                {
                    Namespace = ns,
                    TeamId = teamId,
                    ChallengeId = challengeId,
                    //UserId = deploymentCache?.user_id ?? 0,
                    Name = name,
                    Ready = ready,
                    Status = status,
                    Age = age,
                    IsPending = false,
                });


            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, data: new { label, errorType = "GetPodsByLabelError" });
        }

        return podsResult;
    }

    public async Task<ChallengeDeployResponeDTO?> HandleChallengeRunning(int challengeId, int teamId, string podName, ChallengeDeploymentCacheDTO deploymentCache)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetService<AppDbContext>() ?? throw new Exception("dbcontext null");
            var challenge = await dbContext.Challenges.AsNoTracking()
                .Select(c => new { c.Id, c.TimeLimit })
                .FirstOrDefaultAsync(c => c.Id == challengeId);

            if (challenge == null)
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Challenge not found.",
                    status = (int)HttpStatusCode.NotFound
                };

            // if have time finished keep it; else calculate new finish time and update db as challenge started
            long finalUnixFinished;
            if (deploymentCache.time_finished > DateTimeOffset.UtcNow.ToUnixTimeSeconds())
            {
                finalUnixFinished = deploymentCache.time_finished;
            }
            else
            {
                int minutes = challenge.TimeLimit ?? 30;
                var now = DateTimeOffset.UtcNow;
                finalUnixFinished = now.AddMinutes(minutes).ToUnixTimeSeconds();
                dbContext.ChallengeStartTrackings.Add(new ChallengeStartTracking
                {
                    ChallengeId = challengeId,
                    TeamId = teamId,
                    StartedAt = now.DateTime
                });
                await dbContext.SaveChangesAsync();
            }

            var expiryOffset = DateTimeOffset.FromUnixTimeSeconds(finalUnixFinished);
            var challengeDomain = ChallengeHelper.GenerateChallengeToken(podName, expiryOffset);
            int realTtlSeconds = (int)(expiryOffset - DateTimeOffset.UtcNow).TotalSeconds;

            if (realTtlSeconds <= 0) realTtlSeconds = 60;

            // 4. Update Cache Object
            deploymentCache.status = DeploymentStatus.RUNING;
            deploymentCache.challenge_url = challengeDomain;
            deploymentCache.time_finished = finalUnixFinished;
            deploymentCache.ready = true;

            await _redisHelper.AtomicUpdateExpiration(
                teamId.ToString(),
                ChallengeHelper.GetCacheKey(challengeId, teamId),
                challengeId.ToString(),
                realTtlSeconds,
                JsonSerializer.Serialize(deploymentCache)
            );
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
            _logger.LogError(ex, null, teamId, new { challengeId, podName, errorType = "HandleChallengeRunningError" });
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
                    return phase;
                }

                return WorkflowPhase.Unknown;
            }

            return WorkflowPhase.Unknown;
        }
        catch (k8s.Autorest.HttpOperationException ex) when (ex.Response.StatusCode == HttpStatusCode.NotFound)
        {
            _logger.LogDebug("Workflow not found", new { wfName, namespaceName });
            return WorkflowPhase.Unknown;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, data: new { wfName, namespaceName, errorType = "GetWorkflowStatusError" });
            return WorkflowPhase.Unknown;
        }
    }

    public async Task<string> GetWorkflowLogs(string workflowName, string namespaceName = "argo")
    {
        var sb = new StringBuilder();

        var ansiRegex = new Regex(@"\x1B\[[0-9;]*[A-Za-z]", RegexOptions.None, TimeSpan.FromMilliseconds(200));

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
                    _logger.LogError(ex, data: new { podName = pod.Metadata.Name, containerName, workflowName, namespaceName, errorType = "GetContainerLogsError" });
                    sb.AppendLine($"[Error reading logs from container {containerName}: {ex.Message}]");
                }

                sb.AppendLine();
            }

            sb.AppendLine();
        }
        return sb.ToString();
    }


    public bool IsPodStuck(V1Pod pod)
    {
        var cs = pod.Status?.ContainerStatuses?.FirstOrDefault();
        var reason = "";
        var ageSeconds = 0;

        if (pod.Status?.StartTime != null)
            ageSeconds = (int)(DateTime.UtcNow - pod.Status.StartTime.Value).TotalSeconds;

        if (ageSeconds < 15) return false;

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
        if (fatalReasons.Contains(reason) && ageSeconds > 30)
            return true;

        //crash too many time
        if ((reason == "CrashLoopBackOff" || reason == "OOMKilled") && restartCount > 2)
            return true;

        // ContainerCreating quá lâu
        if (reason == DeploymentReason.CONTAINER_CREATING && ageSeconds > 300)
            return true;

        if (phase == "Failed")
            return true;

        // Running nhưng không ready > 2 phút (nếu không có container status thì coi như not ready)
        if (phase == DeploymentStatus.RUNING && !(cs?.Ready ?? false) && ageSeconds > 180)
            return true;

        return false;
    }

    public async Task<string> GetPodLogs(string namespaceName, string podName)
    {
        try
        {
            var stream = await _kubernetes.CoreV1.ReadNamespacedPodLogAsync(
                name: podName,
                namespaceParameter: namespaceName
            );

            using var reader = new StreamReader(stream);
            var logs = await reader.ReadToEndAsync();

            if (string.IsNullOrWhiteSpace(logs))
                return "No logs available.";

            await Console.Out.WriteLineAsync($"Raw logs for pod {podName} in namespace {namespaceName}:\n{logs}");
            return NormalizeLog(logs);
        }
        catch (Exception ex)
        {
            return $"Error retrieving logs: {ex.Message}";
        }
    }

    public static string NormalizeLog(string raw)
    {
        var ansiRegex = new Regex(@"\x1B\[[0-9;]*[A-Za-z]", RegexOptions.None, TimeSpan.FromMilliseconds(200));
        var clean = ansiRegex.Replace(raw, string.Empty);

        var sb = new StringBuilder();
        var lines = clean.Split('\n');

        foreach (var line in lines)
        {
            var trimmed = line.Trim();

            if (string.IsNullOrWhiteSpace(trimmed))
                continue;

            if (trimmed.StartsWith("warn:", StringComparison.OrdinalIgnoreCase) ||
                trimmed.StartsWith("info:", StringComparison.OrdinalIgnoreCase) ||
                trimmed.StartsWith("fail:", StringComparison.OrdinalIgnoreCase) ||
                trimmed.StartsWith("error:", StringComparison.OrdinalIgnoreCase))
            {
                sb.AppendLine(trimmed);
            }
            else
            {
                sb.AppendLine("      " + trimmed);
            }
        }

        return sb.ToString().TrimStart().TrimEnd();
    }

}
using k8s;
using k8s.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Services;
using ResourceShared.Utils;
using System.Text.Json;
using System.Threading.Channels;
using static ResourceShared.Enums;

namespace DeploymentListener;

public delegate Task OnDeploymentStatusChanged(int teamId, int challengeId, int userId, string status, string? url = null);

public class ChallengesInformerService
{
    private readonly IKubernetes _kubernetes;
    private readonly AppLogger _logger;
    private const string LabelSelector = "ctf/kind=challenge";
    private readonly RedisHelper _redisHelper;
    private readonly IK8sService _k8sService;
    private readonly IServiceScopeFactory _scopeFactory;

    private const int WorkerCount = 20;
    private readonly Channel<(WatchEventType, V1Pod)>[] _shards;
    public ChallengesInformerService(
        IKubernetes kubernetes,
        AppLogger logger,
        RedisHelper redisHelper,
        IK8sService k8sService,
        IServiceScopeFactory scopeFactory)
    {
        _kubernetes = kubernetes;
        _logger = logger;
        _redisHelper = redisHelper;
        _k8sService = k8sService;
        _scopeFactory = scopeFactory;

        //initialize channelshards allows one worker each
        _shards = new Channel<(WatchEventType, V1Pod)>[WorkerCount];
        for (int i = 0; i < WorkerCount; i++)
        {
            _shards[i] = Channel.CreateUnbounded<(WatchEventType, V1Pod)>(new UnboundedChannelOptions
            {
                SingleReader = true,
                SingleWriter = false
            });
        }
    }

    public async Task StartPodWatcher(OnDeploymentStatusChanged statusHandler, CancellationToken cancellationToken = default)
    {
        string? resourceVersion = null;
        int retryCount = 0;
        const int maxRetryDelay = 30000;
        const int baseRetryDelay = 5000;
        const int watchTimeoutSeconds = 300;

        bool forceResync = false;
        var workerTasks = _shards.Select(shard => RunWorker(shard.Reader, statusHandler, cancellationToken)).ToList();
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                if (resourceVersion == null)
                {
                    var initialList = await _kubernetes.CoreV1.ListPodForAllNamespacesAsync(
                        labelSelector: LabelSelector,
                        cancellationToken: cancellationToken
                    );

                    resourceVersion = initialList.Metadata.ResourceVersion;
                    _logger.LogDebug("Starting watch from resourceVersion", new { resourceVersion, LabelSelector });
                    foreach (var pod in initialList.Items)
                    {
                        await DispatchToShard(WatchEventType.Added, pod);
                    }
                }

                using var listTask =
                    _kubernetes.CoreV1.ListPodForAllNamespacesWithHttpMessagesAsync(
                        labelSelector: LabelSelector,
                        watch: true,
                        resourceVersion: resourceVersion,
                        timeoutSeconds: watchTimeoutSeconds,
                        cancellationToken: cancellationToken
                    );

#pragma warning disable CS0618
                var watcher = listTask.WatchAsync<V1Pod, V1PodList>(
                    onError: ex =>
                    {
                        _logger.LogError(ex, data: new
                        {
                            LabelSelector,
                            resourceVersion,
                            errorType = "ProtocolError"
                        });

                        if (ex.Message.Contains("too old", StringComparison.OrdinalIgnoreCase))
                        {
                            forceResync = true;
                        }
                    },
                    cancellationToken: cancellationToken
                );
#pragma warning restore CS0618

                await foreach (var (eventType, pod) in watcher.WithCancellation(cancellationToken))
                {
                    resourceVersion = pod.Metadata.ResourceVersion;
                    await DispatchToShard(eventType, pod);
                    if (forceResync) break;
                }

                retryCount = 0;

                if (forceResync)
                {
                    _logger.LogDebug("Force resync watcher", new { LabelSelector, oldResourceVersion = resourceVersion });

                    resourceVersion = null;
                    forceResync = false;
                    continue;
                }

                _logger.LogDebug("Watch completed, reconnecting", new { LabelSelector, resourceVersion });
            }
            catch (TaskCanceledException)
            {
                _logger.LogDebug("Watcher cancellation requested, stopping", new { LabelSelector });
                break;
            }
            catch (HttpRequestException httpEx)
            {
                retryCount++;
                resourceVersion = null;

                var delay = Math.Min(
                    baseRetryDelay * (int)Math.Pow(2, Math.Min(retryCount - 1, 5)),
                    maxRetryDelay
                );

                delay += Random.Shared.Next(0, 1000);

                _logger.LogError(httpEx, data: new
                {
                    LabelSelector,
                    retryCount,
                    delayMs = delay,
                    errorType = "HttpRequestException"
                }, logLevel: LogLevel.Warning);

                await Task.Delay(delay, cancellationToken);
            }
            catch (k8s.Autorest.HttpOperationException ex) when (ex.Response?.StatusCode == System.Net.HttpStatusCode.Gone)
            {
                _logger.LogDebug("Watcher HTTP 410 Gone, resync",
                    new { LabelSelector, oldResourceVersion = resourceVersion });

                resourceVersion = null;
                retryCount = 0;
            }
            catch (Exception ex)
            {
                retryCount++;
                resourceVersion = null;

                var delay = Math.Min(
                    baseRetryDelay * (int)Math.Pow(2, Math.Min(retryCount - 1, 5)),
                    maxRetryDelay
                );

                _logger.LogError(ex, data: new
                {
                    LabelSelector,
                    retryCount,
                    delayMs = delay,
                    errorType = "GenericException"
                });

                await Task.Delay(delay, cancellationToken);
            }
        }
    }


    private async Task ProcessPodChangeAsync(V1Pod pod, WatchEventType eventType, OnDeploymentStatusChanged onStatusChange)
    {
        if (eventType is WatchEventType.Bookmark or WatchEventType.Error) return;
        if (pod.Metadata == null) return;

        var podName = pod.Metadata.Name;
        var ns = pod.Metadata.NamespaceProperty ?? "unknown";
        var uid = pod.Metadata.Uid ?? "";

        // Get cache
        var (teamId, challengeId) = ChallengeHelper.ParseDeploymentAppName(ns);
        var key = ChallengeHelper.GetCacheKey(challengeId, teamId);
        var cache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(key);
        // pod deleted
        if (eventType == WatchEventType.Deleted)
        {
            await HandleDeletion(teamId, challengeId, key, cache, ns, onStatusChange);
            return;
        }

        //Check ghost pod (pod Added nhưng cache không tồn tại)
        if (cache == null)
        {
            _logger.LogDebug($"Ghost pod detected! Namespace: {ns}, Pod: {pod}");
            await CleanupGhostResources(ns, teamId, challengeId, key, onStatusChange);
            return;
        }
        // pod terminating
        if (pod.Metadata.DeletionTimestamp.HasValue)
        {
            _logger.LogDebug($"Pod is terminating! Namespace: {ns}, Pod: {pod}");
            return;
        }

        // pod restarted
        if (cache.pod_id != uid)
        {
            await HandlePodRestart(uid, teamId, challengeId, key, cache);
        }

        // pod stuck (CrashLoopBackOff, ImagePullBackOff, etc)
        if (_k8sService.IsPodStuck(pod))
        {
            _logger.LogDebug($"Ghost pod detected! Namespace: Pod is stuck, deleting namespace: {ns}, Pod: {pod}");
            await CleanupGhostResources(ns, teamId, challengeId, key, onStatusChange, DeploymentStatus.FAILED);
            return;
        }

        // running state
        await HandleRunningState(pod, teamId, challengeId, cache, onStatusChange);
    }

    #region Sub-Logics

    private async Task HandleDeletion(int teamId, int challengeId, string key, ChallengeDeploymentCacheDTO? cache, string ns, OnDeploymentStatusChanged onStatusChange)
    {
        _logger.LogDebug($"Final cleanup for Challenge {challengeId} (Team {teamId}) (Namespace: {ns})");
        await _redisHelper.AtomicRemoveDeploymentZSet(teamId.ToString(), key, challengeId.ToString());
        await onStatusChange.Invoke(teamId, challengeId, cache?.user_id ?? 0, DeploymentStatus.STOPPED, null);

        try
        {

            using var scope = _scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var challengeTracking = await dbContext.ChallengeStartTrackings
                .FirstOrDefaultAsync(ct => ct.Label == ns && ct.StoppedAt == null);
            if (challengeTracking != null)
            {
                challengeTracking.StoppedAt = DateTime.UtcNow;
                await dbContext.SaveChangesAsync();
            }
            
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, data: new { challengeId, teamId, errorType = "ChallengeStopTrackingSaveError" });
        }
    }
    private async Task CleanupGhostResources(string ns, int teamId, int challengeId, string key, OnDeploymentStatusChanged onStatusChange, string status = DeploymentStatus.STOPPED)
    {
        var deleted = await _k8sService.DeleteNamespace(ns);
        if (deleted)
        {
            await _redisHelper.AtomicRemoveDeploymentZSet(teamId.ToString(), key, challengeId.ToString());
            await onStatusChange.Invoke(teamId, challengeId, 0, status, null);
        }
    }

    private async Task HandlePodRestart(string newUid, int teamId, int challengeId, string key, ChallengeDeploymentCacheDTO cache)
    {
        cache.pod_id = newUid;
        cache.ready = false;
        int remainingTtl = (int)(cache.time_finished - DateTimeOffset.UtcNow.ToUnixTimeSeconds());

        if (remainingTtl > 0)
        {
            var cacheJson = JsonSerializer.Serialize(cache);
            await _redisHelper.AtomicUpdateExpiration(teamId.ToString(), key, challengeId.ToString(), remainingTtl, cacheJson);
        }
    }

    private async Task HandleRunningState(V1Pod pod, int teamId, int challengeId, ChallengeDeploymentCacheDTO cache, OnDeploymentStatusChanged onStatusChange)
    {
        var cs = pod.Status?.ContainerStatuses ?? Array.Empty<V1ContainerStatus>();
        var ready = cs.All(c => c.Ready);
        var podReadyCondition = pod.Status?.Conditions?.Any(c => c.Type == "Ready" && c.Status == "True") == true;

        if (ready && podReadyCondition && cache.status != DeploymentStatus.DELETING)
        {
            if (cache.ready == true) return;

            var deployResult = await _k8sService.HandleChallengeRunning(challengeId, teamId, cache._namespace, cache);
            await onStatusChange.Invoke(
                teamId,
                challengeId,
                cache.user_id,
                DeploymentStatus.RUNING,
                deployResult?.challenge_url ?? ""
            );
        }
    }

    #endregion 


    private async Task DispatchToShard(WatchEventType eventType, V1Pod pod)
    {
        if (pod.Metadata?.Uid == null) return;

        // split pods into shards based on hash of UID
        uint hash = (uint)pod.Metadata.Uid.GetHashCode();
        int shardIndex = (int)(hash % WorkerCount);

        await _shards[shardIndex].Writer.WriteAsync((eventType, pod));
    }

    private async Task RunWorker(ChannelReader<(WatchEventType, V1Pod)> reader, OnDeploymentStatusChanged statusHandler, CancellationToken ct)
    {
        await foreach (var (eventType, pod) in reader.ReadAllAsync(ct))
        {
            try
            {
                await ProcessPodChangeAsync(pod, eventType, statusHandler);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex);
            }
        }
    }
}

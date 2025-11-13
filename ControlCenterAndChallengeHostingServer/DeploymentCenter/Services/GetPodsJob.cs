using ResourceShared.Configs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Models;
using ResourceShared.Services;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using System.Text.Json;

namespace DeploymentCenter.Services
{
    public interface IGetPodsJob
    {
        Task RunAsync(CancellationToken ct);
    }

    public class GetPodsJob : IGetPodsJob
    {
        private readonly IK8sService _k8SHealthService;
        private readonly RedisHelper _redisHelper;

        public GetPodsJob(  IK8sService k8SHealthService, RedisHelper redisHelper)
        {
            _redisHelper = redisHelper;
            //K8S-NOTE: comment this state for runing in local with out k8s cubeconfig 
            _k8SHealthService = k8SHealthService;
        }

        public async Task RunAsync(CancellationToken ct)
        {
            await Console.Out.WriteLineAsync("GetPodsJob is running.");

            try
            {
                var cachedPods = await _redisHelper.GetFromCacheAsync<List<PodInfo>>(RedisConfigs.PodsInfoKey) ?? new();
                
                //K8S-NOTE:comment this state for runing in local with out k8s cubeconfig 
                var currentPods = await _k8SHealthService.GetPodsByLabel();
                var liveNamespaces = currentPods.Select(p => p.Namespace).ToHashSet();

                // Tách pending và running pods từ cache
                var pendingPods = cachedPods.Where(p => p.IsPending).ToList();
                var runningPods = cachedPods.Where(p => !p.IsPending).ToList();
                
                // Những running pod trong cache nhưng không còn trong K8s → dead
                var deadPods = runningPods
                    .Where(p => !liveNamespaces.Contains(p.Namespace))
                    .ToList();
                
                // Pending pods đã xuất hiện trong K8s → xóa khỏi pending (currentPods đã có rồi)
                var stillPendingPods = pendingPods
                    .Where(p => !liveNamespaces.Contains(p.Namespace))
                    .ToList();
                
                var promotedCount = pendingPods.Count - stillPendingPods.Count;
                await Console.Out.WriteLineAsync($"Found {deadPods?.Count ?? 0} dead pods, {currentPods?.Count ?? 0} alive pods, {promotedCount} pending→running");

                // Xử lý các pod không còn chạy xóa cache liên quan
                foreach (var deadPod in deadPods ?? Enumerable.Empty<PodInfo>())
                {
                    await Console.Out.WriteLineAsync($"Pod {deadPod.Name} in Namespace {deadPod.Namespace} is no longer running. Removing from cache.");
                    var startedKey = ChallengeHelper.GetArgoWName(deadPod.ChallengeId, deadPod.TeamId);
                    var runnedKey = ChallengeHelper.GetCacheKey(deadPod.ChallengeId, deadPod.TeamId);

                    await Console.Out.WriteLineAsync($"Removed cache keys: {startedKey}, {JsonSerializer.Serialize(_redisHelper.GetFromCacheAsync<DeploymentInfo>(startedKey))}");
                    await Console.Out.WriteLineAsync($"Removed cache keys: {runnedKey}, {JsonSerializer.Serialize(_redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(runnedKey))}");
                    await _redisHelper.RemoveCacheAsync(startedKey);
                    await _redisHelper.RemoveCacheAsync(runnedKey);

                }
                
                // Merge: currentPods (running from K8s) + stillPendingPods (chưa deploy xong)
                var finalPods = (currentPods ?? new List<PodInfo>()).Concat(stillPendingPods).ToList();
                await _redisHelper.SetCacheAsync(RedisConfigs.PodsInfoKey, finalPods);
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"GetPodsJob encountered an error: {ex.Message}");
            }
        }
    }
}

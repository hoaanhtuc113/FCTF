using ResourceShared.Configs;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Services;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;

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
                var runningPods = await _redisHelper.GetFromCacheAsync<List<PodInfo>>(RedisConfigs.PodsInfoKey);
                //K8S-NOTE:comment this state for runing in local with out k8s cubeconfig 
                var pods = await _k8SHealthService.GetPodsByLabel();

                // Lấy danh sách pod không còn chạy
                var deadPods = runningPods?.ExceptBy(pods.Select(p => (p.ChallengeId, p.TeamId)), p =>(p.ChallengeId, p.TeamId)).ToList();

                // Xử lý các pod không còn chạy xóa cache liên quan
                foreach (var deadPod in deadPods ?? Enumerable.Empty<PodInfo>())
                {
                    await Console.Out.WriteLineAsync($"Pod {deadPod.Name} in Namespace {deadPod.Namespace} is no longer running. Removing from cache.");
                    var startedKey = ChallengeHelper.GetArgoWName(deadPod.ChallengeId, deadPod.TeamId);
                    var runnedKey = ChallengeHelper.GetCacheKey(deadPod.ChallengeId, deadPod.TeamId);

                    await _redisHelper.RemoveCacheAsync(startedKey);
                    await _redisHelper.RemoveCacheAsync(runnedKey);
                    await Console.Out.WriteLineAsync($"Removed cache keys: {startedKey}, {runnedKey}");
                }
                await _redisHelper.SetCacheAsync(RedisConfigs.PodsInfoKey, pods);
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"GetPodsJob encountered an error: {ex.Message}");
            }
        }
    }
}

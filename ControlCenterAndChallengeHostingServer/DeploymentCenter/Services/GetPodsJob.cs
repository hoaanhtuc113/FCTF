using ResourceShared.Configs;
using ResourceShared.Services;
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
                //K8S-NOTE:comment this state for runing in local with out k8s cubeconfig 
                var pods = await _k8SHealthService.GetPodsByLabel();
                await _redisHelper.SetCacheAsync(RedisConfigs.PodsInfoKey, pods);
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"GetPodsJob encountered an error: {ex.Message}");
            }
        }
    }
}

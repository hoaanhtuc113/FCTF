
using DeploymentCenter.Utils;
using ResourceShared.Utils;

namespace DeploymentCenter.Services
{

    public sealed class PodsWorkerService : BackgroundService
    {

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly RedisLockHelper _redisLockHelper;

        public PodsWorkerService(IServiceScopeFactory scopeFactory, RedisLockHelper redisLockHelper)
        {
            _scopeFactory = scopeFactory;
            _redisLockHelper = redisLockHelper;
        }
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var timer = new PeriodicTimer(TimeSpan.FromSeconds(DeploymentCenterConfigHelper.WORKER_SERVICE_INTERVAL));
            try
            {
                await RunLockedJob(stoppingToken);
                await GetAllChallengesPods(stoppingToken);

                while (await timer.WaitForNextTickAsync(stoppingToken))
                {
                    await GetAllChallengesPods(stoppingToken);
                }
            }
            catch (OperationCanceledException)
            {
                await Console.Out.WriteLineAsync("PodsWorkerService operation was canceled.");
            }
            finally
            {
                await Console.Out.WriteLineAsync("PodsWorkerService is stopping.");
            }
        }


        private async Task GetAllChallengesPods(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var myService = scope.ServiceProvider.GetRequiredService<IGetPodsJob>();
            await myService.RunAsync(ct);
        }

        private async Task RunLockedJob(CancellationToken ct)
        {
            var lockKey = "lock:pods";
            var token = Guid.NewGuid().ToString();

            bool acquired = await _redisLockHelper.AcquireWithRetry(
                lockKey,
                token,
                TimeSpan.FromSeconds(5),
                retry: 25,
                delayMs: 40
            );

            if (!acquired)
            {
                await Console.Out.WriteLineAsync("[Worker] Lock busy → skip this cycle");
                return;
            }

            try
            {
                await GetAllChallengesPods(ct);
            }
            finally
            {
                await _redisLockHelper.ReleaseLock(lockKey, token);
            }
        }

    }
}

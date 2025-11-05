
using DeploymentCenter.Utils;

namespace DeploymentCenter.Services
{

    public sealed class PodsWorkerService : BackgroundService
    {

        private readonly IServiceScopeFactory _scopeFactory;

        public PodsWorkerService(IServiceScopeFactory scopeFactory)
        {
            _scopeFactory = scopeFactory;
        }
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var timer = new PeriodicTimer(TimeSpan.FromSeconds(DeploymentCenterConfigHelper.WORKER_SERVICE_INTERVAL));
            try
            {
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
    }
}

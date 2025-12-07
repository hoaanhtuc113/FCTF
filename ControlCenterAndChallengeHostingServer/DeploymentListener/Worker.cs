using DeploymentListener.Services;
using DeploymentListener.Utils;
using ResourceShared.Utils;

namespace DeploymentListener;

public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly RedisLockHelper _redisLockHelper;

    public Worker(ILogger<Worker> logger, IServiceScopeFactory scopeFactory, RedisLockHelper redisLockHelper)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _redisLockHelper = redisLockHelper;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var myService = scope.ServiceProvider.GetRequiredService<IGetPodsJob>();
            await myService.StartWatchingAsync(stoppingToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Worker crashed");
        }
    }
}

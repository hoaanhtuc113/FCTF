namespace ContestantBE.Services;

/// <summary>
/// Background service: poll KYPO Progress API mỗi N giây,
/// tự động ghi điểm cho team đã hoàn thành.
/// </summary>
public class KypoPollingService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<KypoPollingService> _logger;

    public KypoPollingService(IServiceScopeFactory scopeFactory, ILogger<KypoPollingService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger       = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[KYPO POLL] ✅ Started (interval={Interval}s)", KypoPollingConfig.PollIntervalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(KypoPollingConfig.PollIntervalSeconds), stoppingToken);

            try
            {
                await RunPollCycleAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[KYPO POLL] Poll cycle lỗi");
            }
        }

        _logger.LogInformation("[KYPO POLL] Stopped");
    }

    private async Task RunPollCycleAsync()
    {
        // BackgroundService không thể dùng Scoped service trực tiếp
        // → tạo scope mới mỗi lần poll
        using var scope = _scopeFactory.CreateScope();
        var syncService = scope.ServiceProvider.GetRequiredService<KypoSyncService>();

        var newSolves = await syncService.SyncAllAsync();
        if (newSolves > 0)
            _logger.LogInformation("[KYPO POLL] Chu kỳ này: +{Count} solve(s) mới", newSolves);
    }
}

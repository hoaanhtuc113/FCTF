using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ContestantBE.Services;

public class KypyCacheWarmupService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly KypoApiClient        _kypoClient;
    private readonly ILogger<KypyCacheWarmupService> _logger;
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);

    public KypyCacheWarmupService(
        IServiceScopeFactory scopeFactory,
        KypoApiClient        kypoClient,
        ILogger<KypyCacheWarmupService> logger)
    {
        _scopeFactory = scopeFactory;
        _kypoClient   = kypoClient;
        _logger       = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await WarmupAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "[KYPO Warmup] Error during cache warmup");
            }

            await Task.Delay(Interval, stoppingToken);
        }
    }

    private async Task WarmupAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var configs = await db.KypoChallengeConfigs
            .AsNoTracking()
            .ToListAsync(ct);

        var instances = configs
            .GroupBy(c => (c.KypoBaseUrl, c.KypoInstanceType, c.KypoInstanceId))
            .Select(g => g.First())
            .ToList();

        if (instances.Count == 0) return;

        foreach (var cfg in instances)
        {
            if (ct.IsCancellationRequested) break;
            if (string.IsNullOrEmpty(cfg.KypoBaseUrl)) continue;

            var baseUrl = cfg.KypoBaseUrl.TrimEnd('/');

            try
            {
                await _kypoClient.GetInstanceProgressAsync(
                    baseUrl, cfg.KypoInstanceType, cfg.KypoInstanceId);

                await _kypoClient.GetTrainingDefinitionLevelCountAsync(
                    baseUrl, cfg.KypoInstanceType, cfg.KypoInstanceId);

                _logger.LogDebug("[KYPO Warmup] instance={Id} warmed", cfg.KypoInstanceId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[KYPO Warmup] Failed for instance {Id}", cfg.KypoInstanceId);
            }
        }
    }
}

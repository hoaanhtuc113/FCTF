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
            try { await WarmupAsync(stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "[KYPO Warmup] Lỗi cache warmup");
            }

            await Task.Delay(Interval, stoppingToken);
        }
    }

    private async Task WarmupAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var configs = await db.Database.SqlQueryRaw<KypoChallengeConfig>(
            "SELECT id, challenge_id, kypo_instance_id, kypo_access_token, kypo_instance_type, kypo_base_url " +
            "FROM kypo_challenge_configs"
        ).ToListAsync(ct);

        var instances = configs
            .GroupBy(c => (c.kypo_base_url, c.kypo_instance_type, c.kypo_instance_id))
            .Select(g => g.First())
            .ToList();

        if (instances.Count == 0) return;

        foreach (var cfg in instances)
        {
            if (ct.IsCancellationRequested) break;
            if (string.IsNullOrEmpty(cfg.kypo_base_url)) continue;

            var baseUrl      = cfg.kypo_base_url.TrimEnd('/');
            var instanceType = cfg.kypo_instance_type ?? "linear";

            try
            {
                await _kypoClient.GetInstanceProgressAsync(baseUrl, instanceType, cfg.kypo_instance_id);
                await _kypoClient.GetTrainingDefinitionLevelCountAsync(baseUrl, instanceType, cfg.kypo_instance_id);
                _logger.LogDebug("[KYPO Warmup] instance={Id} warmed", cfg.kypo_instance_id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[KYPO Warmup] Lỗi instance {Id}", cfg.kypo_instance_id);
            }
        }
    }
}

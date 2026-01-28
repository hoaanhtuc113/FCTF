using Microsoft.Extensions.Hosting;
using ResourceShared.Logger;

namespace DeploymentListener;

public class Worker : BackgroundService
{
    private readonly AppLogger _logger;
    private readonly ChallengesInformerService _challengeInformerService;

    public Worker(
        ChallengesInformerService challengeInformerService,
        AppLogger logger)
    {
        _challengeInformerService = challengeInformerService;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            static async Task statusHandler(
                int teamId,
                int challengeId,
                int userId,
                string status,
                string? url = null)
            {

            }

            await _challengeInformerService.StartPodWatcher(statusHandler, stoppingToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex);
        }
    }
}

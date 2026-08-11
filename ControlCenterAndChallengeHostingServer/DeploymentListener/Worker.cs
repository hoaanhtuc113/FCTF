using Microsoft.Extensions.Hosting;
using ResourceShared.Logger;

namespace DeploymentListener;

public class Worker : BackgroundService
{
    private readonly AppLogger _logger;
    private readonly ChallengesInformerService _challengeInformerService;
    private readonly WorkerHeartbeat _heartbeat;

    public Worker(
        ChallengesInformerService challengeInformerService,
        AppLogger logger,
        WorkerHeartbeat heartbeat)
    {
        _challengeInformerService = challengeInformerService;
        _logger = logger;
        _heartbeat = heartbeat;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _heartbeat.SetPodWatcherRunning(true);
        try
        {
            async Task statusHandler(
                int teamId,
                int challengeId,
                int userId,
                string status,
                string? url = null)
            {
                _logger.LogDebug($"Pod team: {teamId}, challenge: {challengeId} status changed: {status}");
            }

            await _challengeInformerService.StartPodWatcher(statusHandler, stoppingToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex);
        }
        finally
        {
            // If StartPodWatcher ever returns - success or exception - the
            // informer has stopped for good (it's not restarted). Report
            // unhealthy so K8s restarts the pod instead of leaving a
            // container that looks Running but no longer watches anything.
            _heartbeat.SetPodWatcherRunning(false);
        }
    }
}

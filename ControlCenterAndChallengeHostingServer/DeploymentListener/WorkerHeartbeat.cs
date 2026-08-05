namespace DeploymentListener;

public class WorkerHeartbeat
{
    private volatile bool _podWatcherRunning;
    private DateTime _lastCleanupTickUtc = DateTime.UtcNow;

    public void SetPodWatcherRunning(bool running) => _podWatcherRunning = running;

    public void PingCleanupTick() => _lastCleanupTickUtc = DateTime.UtcNow;

    public bool IsHealthy(TimeSpan maxCleanupStaleness) =>
        _podWatcherRunning && DateTime.UtcNow - _lastCleanupTickUtc < maxCleanupStaleness;
}

namespace DeploymentConsumer.Services;

public class WorkerHeartbeat
{
    private DateTime _lastTickUtc = DateTime.UtcNow;

    public void Ping() => _lastTickUtc = DateTime.UtcNow;

    public bool IsHealthy(TimeSpan maxStaleness) => DateTime.UtcNow - _lastTickUtc < maxStaleness;
}

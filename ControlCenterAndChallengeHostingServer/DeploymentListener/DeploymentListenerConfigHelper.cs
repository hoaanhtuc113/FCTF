namespace DeploymentListener;

public class DeploymentListenerConfigHelper
{
    public static string REDIS_CONNECTION_STRING = "";
    public static string PRIVATE_KEY = "";
    public static int CHALLENGE_WATCHER_WORKER_COUNT = 20;

    public void InitConfig()
    {
        REDIS_CONNECTION_STRING = GetRequiredEnv("REDIS_CONNECTION");
        PRIVATE_KEY = GetRequiredEnv("PRIVATE_KEY");

        var workerCountRaw = Environment.GetEnvironmentVariable("CHALLENGE_WATCHER_WORKER_COUNT") ?? "20";
        if (int.TryParse(workerCountRaw, out var workerCountParsed) && workerCountParsed > 0)
        {
            CHALLENGE_WATCHER_WORKER_COUNT = workerCountParsed;
        }
    }

    private static string GetRequiredEnv(string key)
    {
        return Environment.GetEnvironmentVariable(key)
            ?? throw new Exception($"Can't read env: {key}");
    }
}
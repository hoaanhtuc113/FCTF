using ResourceShared.Utils;

namespace DeploymentListener;

public class DeploymentListenerConfigHelper : SharedConfig
{
    public static int CHALLENGE_WATCHER_WORKER_COUNT = 20;

    public override void InitConfig()
    {
        base.InitConfig();

        var workerCountRaw = configuration["CHALLENGE_WATCHER_WORKER_COUNT"] ?? "20";
        if (int.TryParse(workerCountRaw, out var workerCountParsed) && workerCountParsed > 0)
        {
            CHALLENGE_WATCHER_WORKER_COUNT = workerCountParsed;
        }
    }
}
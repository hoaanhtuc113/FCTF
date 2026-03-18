namespace DeploymentConsumer;

public class DeploymentConsumerConfigHelper
{
    public static string REDIS_CONNECTION_STRING = "";
    public static string PRIVATE_KEY = "";
    public static string START_CHALLENGE_TEMPLATE = "";
    public static string RABBIT_HOST = "";
    public static string RABBIT_USERNAME = "";
    public static string RABBIT_PASSWORD = "";
    public static string RABBIT_VHOST = "/";
    public static int RABBIT_PORT = 5672;

    public static string ARGO_WORKFLOWS_URL = "";
    public static string ARGO_WORKFLOWS_TOKEN = "";
    public static string POD_START_TIMEOUT_MINUTES = "";

    public static int ARGO_DEPLOY_TTL_MINUTES = 6;
    public static int BATCH_SIZE = 20;
    public static int MAX_RUNNING_WORKFLOW = 30;
    public static int WORKER_POLL_INTERVAL_SECONDS = 2;

    public void InitConfig()
    {
        REDIS_CONNECTION_STRING = GetRequiredEnv("REDIS_CONNECTION");
        PRIVATE_KEY = GetRequiredEnv("PRIVATE_KEY");
        START_CHALLENGE_TEMPLATE = GetRequiredEnv("START_CHALLENGE_TEMPLATE");
        RABBIT_HOST = GetRequiredEnv("RABBIT_HOST");
        RABBIT_USERNAME = GetRequiredEnv("RABBIT_USERNAME");
        RABBIT_PASSWORD = GetRequiredEnv("RABBIT_PASSWORD");
        RABBIT_VHOST = Environment.GetEnvironmentVariable("RABBIT_VHOST") ?? "/";
        RABBIT_PORT = int.TryParse(GetRequiredEnv("RABBIT_PORT"), out var rabbitPort) ? rabbitPort : throw new Exception("Invalid RABBIT_PORT");

        ARGO_WORKFLOWS_URL = GetRequiredEnv("ARGO_WORKFLOWS_URL");
        ARGO_WORKFLOWS_TOKEN = GetRequiredEnv("ARGO_WORKFLOWS_TOKEN");

        POD_START_TIMEOUT_MINUTES = Environment.GetEnvironmentVariable("POD_START_TIMEOUT_MINUTES") ?? "5";

        var queueTimeoutMinutesRaw = Environment.GetEnvironmentVariable("ARGO_DEPLOY_TTL_MINUTES") ?? "6";
        if (int.TryParse(queueTimeoutMinutesRaw, out var queueTimeoutMinutesParsed) && queueTimeoutMinutesParsed > 0)
        {
            ARGO_DEPLOY_TTL_MINUTES = queueTimeoutMinutesParsed;
        }

        var batchSizeRaw = Environment.GetEnvironmentVariable("BATCH_SIZE") ?? "20";
        if (int.TryParse(batchSizeRaw, out var batchSizeParsed) && batchSizeParsed > 0)
        {
            BATCH_SIZE = batchSizeParsed;
        }

        var maxRunningWorkflowRaw = Environment.GetEnvironmentVariable("MAX_RUNNING_WORKFLOW") ?? "30";
        if (int.TryParse(maxRunningWorkflowRaw, out var maxRunningWorkflowParsed) && maxRunningWorkflowParsed > 0)
        {
            MAX_RUNNING_WORKFLOW = maxRunningWorkflowParsed;
        }

        var pollIntervalRaw = Environment.GetEnvironmentVariable("WORKER_POLL_INTERVAL_SECONDS") ?? "2";
        if (int.TryParse(pollIntervalRaw, out var pollIntervalParsed) && pollIntervalParsed > 0)
        {
            WORKER_POLL_INTERVAL_SECONDS = pollIntervalParsed;
        }
    }

    private static string GetRequiredEnv(string key)
    {
        return Environment.GetEnvironmentVariable(key)
            ?? throw new Exception($"Can't read env: {key}");
    }
}

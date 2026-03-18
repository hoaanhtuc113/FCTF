using ResourceShared.Utils;

namespace DeploymentConsumer;

public class DeploymentConsumerConfigHelper : SharedConfig
{
    public static string ARGO_WORKFLOWS_URL = "";
    public static string ARGO_WORKFLOWS_TOKEN = "";
    public static string POD_START_TIMEOUT_MINUTES = "";

    public static int ARGO_DEPLOY_TTL_MINUTES = 6;
    public static int BATCH_SIZE = 20;
    public static int MAX_RUNNING_WORKFLOW = 30;
    public static int WORKER_POLL_INTERVAL_SECONDS = 2;

    public static string RABBIT_CONSUMER_HOST = "";
    public static string RABBIT_CONSUMER_USERNAME = "";
    public static string RABBIT_CONSUMER_PASSWORD = "";
    public static string RABBIT_CONSUMER_VHOST = "/";
    public static int RABBIT_CONSUMER_PORT = 5672;

    public override void InitConfig()
    {
        base.InitConfig();
        ARGO_WORKFLOWS_URL = configuration["ARGO_WORKFLOWS_URL"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_URL");
        ARGO_WORKFLOWS_TOKEN = configuration["ARGO_WORKFLOWS_TOKEN"] ?? throw new Exception("Can't read ServiceConfigs:ARGO_WORKFLOWS_TOKEN");

        POD_START_TIMEOUT_MINUTES = configuration["POD_START_TIMEOUT_MINUTES"] ?? "5";

        var queueTimeoutMinutesRaw = configuration["ARGO_DEPLOY_TTL_MINUTES"] ?? "6";
        if (int.TryParse(queueTimeoutMinutesRaw, out var queueTimeoutMinutesParsed) && queueTimeoutMinutesParsed > 0)
        {
            ARGO_DEPLOY_TTL_MINUTES = queueTimeoutMinutesParsed;
        }

        var batchSizeRaw = configuration["BATCH_SIZE"] ?? "20";
        if (int.TryParse(batchSizeRaw, out var batchSizeParsed) && batchSizeParsed > 0)
        {
            BATCH_SIZE = batchSizeParsed;
        }

        var maxRunningWorkflowRaw = configuration["MAX_RUNNING_WORKFLOW"] ?? "30";
        if (int.TryParse(maxRunningWorkflowRaw, out var maxRunningWorkflowParsed) && maxRunningWorkflowParsed > 0)
        {
            MAX_RUNNING_WORKFLOW = maxRunningWorkflowParsed;
        }

        var pollIntervalRaw = configuration["WORKER_POLL_INTERVAL_SECONDS"] ?? "2";
        if (int.TryParse(pollIntervalRaw, out var pollIntervalParsed) && pollIntervalParsed > 0)
        {
            WORKER_POLL_INTERVAL_SECONDS = pollIntervalParsed;
        }

        RABBIT_CONSUMER_HOST =
            configuration["RABBIT_CONSUMER_HOST"]
            ?? throw new Exception("Can't read RABBIT_CONSUMER_HOST");

        RABBIT_CONSUMER_USERNAME =
            configuration["RABBIT_CONSUMER_USERNAME"]
            ?? throw new Exception("Can't read RABBIT_CONSUMER_USERNAME");

        RABBIT_CONSUMER_PASSWORD =
            configuration["RABBIT_CONSUMER_PASSWORD"]
            ?? throw new Exception("Can't read RABBIT_CONSUMER_PASSWORD");

        var rabbitPortRaw = configuration["RABBIT_CONSUMER_PORT"];
        RABBIT_CONSUMER_PORT = int.TryParse(rabbitPortRaw, out var rabbitPort)
            ? rabbitPort
            : throw new Exception("Can't read RABBIT_CONSUMER_PORT");

        RABBIT_CONSUMER_VHOST =
            configuration["RABBIT_CONSUMER_VHOST"]
            ?? "/";
    }
}

namespace DeploymentCenter.Utils;

public class DeploymentCenterConfigHelper
{
    public static string REDIS_CONNECTION_STRING = "";
    public static string PRIVATE_KEY = "";
    public static string RABBIT_HOST = "";
    public static string RABBIT_USERNAME = "";
    public static string RABBIT_PASSWORD = "";
    public static string RABBIT_VHOST = "/";
    public static int RABBIT_PORT = 5672;
    public static bool RABBIT_TLS = false;

    public static string ARGO_WORKFLOWS_URL = "";
    public static string ARGO_WORKFLOWS_TOKEN_FILE = "/var/run/secrets/kubernetes.io/serviceaccount/token";
    public static string POD_START_TIMEOUT_MINUTES = "";
    public static string LOKI_BASE_URL = "http://loki-stack:3100";
    public static string LOKI_QUERY_SELECTOR = "{app=\"challenge-gateway\"}";

    public static int DEPLOYMENT_QUEUE_TIMEOUT_MINUTES = 5;

    // How many messages one contest may hold in deployment_queue. The queue is
    // shared by every contest and capped by x-max-length, so without a per-contest
    // ceiling a busy contest fills it and the others are refused with 429 without
    // having deployed anything. 0 disables the quota (previous behaviour).
    public static int MAX_QUEUED_PER_CONTEST = 100;

    public void InitConfig()
    {
        REDIS_CONNECTION_STRING = GetRequiredEnv("REDIS_CONNECTION");
        PRIVATE_KEY = GetRequiredEnv("PRIVATE_KEY");
        RABBIT_HOST = GetRequiredEnv("RABBIT_HOST");
        RABBIT_USERNAME = GetRequiredEnv("RABBIT_USERNAME");
        RABBIT_PASSWORD = GetRequiredEnv("RABBIT_PASSWORD");
        RABBIT_VHOST = Environment.GetEnvironmentVariable("RABBIT_VHOST") ?? "/";
        RABBIT_PORT = int.TryParse(GetRequiredEnv("RABBIT_PORT"), out var rabbitPort) ? rabbitPort : throw new Exception("Invalid RABBIT_PORT");
        RABBIT_TLS = bool.TryParse(Environment.GetEnvironmentVariable("RABBIT_TLS"), out var rabbitTls) && rabbitTls;

        ARGO_WORKFLOWS_URL = GetRequiredEnv("ARGO_WORKFLOWS_URL");
        ARGO_WORKFLOWS_TOKEN_FILE = Environment.GetEnvironmentVariable("ARGO_WORKFLOWS_TOKEN_FILE")
            ?? "/var/run/secrets/kubernetes.io/serviceaccount/token";
        POD_START_TIMEOUT_MINUTES = Environment.GetEnvironmentVariable("POD_START_TIMEOUT_MINUTES") ?? "5";
        LOKI_BASE_URL = Environment.GetEnvironmentVariable("LOKI_BASE_URL") ?? "http://loki-stack:3100";
        LOKI_QUERY_SELECTOR = Environment.GetEnvironmentVariable("LOKI_QUERY_SELECTOR") ?? "{app=\"challenge-gateway\"}";

        if (string.IsNullOrWhiteSpace(LOKI_BASE_URL))
        {
            LOKI_BASE_URL = "http://loki-stack:3100";
        }
        if (string.IsNullOrWhiteSpace(LOKI_QUERY_SELECTOR))
        {
            LOKI_QUERY_SELECTOR = "{app=\"challenge-gateway\"}";
        }

        var deploymentQueueTimeoutRaw = Environment.GetEnvironmentVariable("DEPLOYMENT_QUEUE_TIMEOUT_MINUTES") ?? "5";
        if (!int.TryParse(deploymentQueueTimeoutRaw, out var deploymentQueueTimeoutMinutes) || deploymentQueueTimeoutMinutes <= 0)
        {
            deploymentQueueTimeoutMinutes = 5;
        }

        DEPLOYMENT_QUEUE_TIMEOUT_MINUTES = deploymentQueueTimeoutMinutes;

        // A negative value means nothing here, so it falls back to the default
        // rather than being read as "disabled" - only an explicit 0 disables.
        var maxQueuedPerContestRaw = Environment.GetEnvironmentVariable("MAX_QUEUED_PER_CONTEST");
        if (!int.TryParse(maxQueuedPerContestRaw, out var maxQueuedPerContest) || maxQueuedPerContest < 0)
        {
            maxQueuedPerContest = 100;
        }

        MAX_QUEUED_PER_CONTEST = maxQueuedPerContest;
    }

    private static string GetRequiredEnv(string key)
    {
        return Environment.GetEnvironmentVariable(key)
            ?? throw new Exception($"Can't read env: {key}");
    }

    public static string GetArgoWorkflowsBearerToken()
    {
        if (!string.IsNullOrWhiteSpace(ARGO_WORKFLOWS_TOKEN_FILE)
            && System.IO.File.Exists(ARGO_WORKFLOWS_TOKEN_FILE))
        {
            var tokenFromFile = System.IO.File.ReadAllText(ARGO_WORKFLOWS_TOKEN_FILE).Trim();
            if (!string.IsNullOrWhiteSpace(tokenFromFile))
            {
                return tokenFromFile;
            }
        }

        // Backward-compatible fallback for local/dev environments.
        var tokenFromEnv = Environment.GetEnvironmentVariable("ARGO_WORKFLOWS_TOKEN");
        if (!string.IsNullOrWhiteSpace(tokenFromEnv))
        {
            return tokenFromEnv.Trim();
        }

        throw new Exception("Unable to resolve Argo bearer token from service account token file or ARGO_WORKFLOWS_TOKEN env.");
    }
}

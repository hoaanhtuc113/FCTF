namespace ContestantBE.Services;

/// <summary>
/// Config cho KYPO Polling — đọc từ environment variables.
/// </summary>
public static class KypoPollingConfig
{
    public static string AdminUsername { get; private set; } = "";
    public static string AdminPassword { get; private set; } = "";
    public static string ClientId      { get; private set; } = "CRCZP-Client";
    public static int    PollIntervalSeconds { get; private set; } = 10;

    public static void Init()
    {
        AdminUsername       = Environment.GetEnvironmentVariable("KYPO_ADMIN_USERNAME") ?? "crczp-admin";
        AdminPassword       = Environment.GetEnvironmentVariable("KYPO_ADMIN_PASSWORD") ?? "";
        ClientId            = Environment.GetEnvironmentVariable("KYPO_CLIENT_ID")      ?? "CRCZP-Client";
        PollIntervalSeconds = int.TryParse(
            Environment.GetEnvironmentVariable("KYPO_POLL_INTERVAL_SECONDS"), out var v) ? v : 10;
    }
}

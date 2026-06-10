using ContestantBE.Utils;

namespace ContestantBE.Services;

/// <summary>
/// Config cho KYPO Polling — đọc từ bảng config trong DB, fallback về ENV.
/// Keys DB khớp với ManagementPlatform: kypo_username, kypo_password, ...
/// </summary>
public static class KypoPollingConfig
{
    public static string AdminUsername         { get; private set; } = "";
    public static string AdminPassword         { get; private set; } = "";
    public static string ClientId              { get; private set; } = "CRCZP-Client";
    public static string KeycloakAdminUsername { get; private set; } = "admin";
    public static string KeycloakAdminPassword { get; private set; } = "";

    public static void Init(string dbConnectionString)
    {
        using var db = DbConfigReader.BuildTempContext(dbConnectionString);
        AdminUsername         = DbConfigReader.GetOptional(db, "kypo_username",       "KYPO_ADMIN_USERNAME")         ?? "crczp-admin";
        AdminPassword         = DbConfigReader.GetOptional(db, "kypo_password",       "KYPO_ADMIN_PASSWORD")         ?? "";
        ClientId              = DbConfigReader.GetOptional(db, "kypo_client_id",      "KYPO_CLIENT_ID")              ?? "CRCZP-Client";
        KeycloakAdminUsername = DbConfigReader.GetOptional(db, "kypo_admin_username", "KYPO_KEYCLOAK_ADMIN_USERNAME") ?? "admin";
        KeycloakAdminPassword = DbConfigReader.GetOptional(db, "kypo_admin_password", "KYPO_KEYCLOAK_ADMIN_PASSWORD") ?? "";
    }
}

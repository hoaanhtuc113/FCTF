using ResourceShared.Utils;

namespace ContestantBE.Services;

public interface IKypoConfigProvider
{
    string ClientId              { get; }
    string AdminUsername         { get; }
    string AdminPassword         { get; }
    string KeycloakAdminUsername { get; }
    string KeycloakAdminPassword { get; }
}

/// <summary>
/// Singleton that reads KYPO credentials from DB config table on every access (dynamic).
/// Uses IServiceScopeFactory to access scoped ConfigHelper from a singleton.
/// DB keys match ManagementPlatform's kypo_config.py.
/// Config changes in DB take effect immediately without restart.
/// </summary>
public class KypoConfigProvider : IKypoConfigProvider
{
    private readonly IServiceScopeFactory _scopeFactory;

    public KypoConfigProvider(IServiceScopeFactory scopeFactory)
        => _scopeFactory = scopeFactory;

    private string Get(string dbKey, string envKey, string defaultValue = "")
    {
        using var scope = _scopeFactory.CreateScope();
        var cfg = scope.ServiceProvider.GetRequiredService<ConfigHelper>();
        return cfg.GetDbOrEnvConfig(dbKey, envKey, defaultValue);
    }

    public string ClientId              => Get("kypo_client_id",      "KYPO_CLIENT_ID",               "CRCZP-Client");
    public string AdminUsername         => Get("kypo_username",        "KYPO_ADMIN_USERNAME",          "crczp-admin");
    public string AdminPassword         => Get("kypo_password",        "KYPO_ADMIN_PASSWORD");
    public string KeycloakAdminUsername => Get("kypo_admin_username",  "KYPO_KEYCLOAK_ADMIN_USERNAME", "admin");
    public string KeycloakAdminPassword => Get("kypo_admin_password",  "KYPO_KEYCLOAK_ADMIN_PASSWORD");
}

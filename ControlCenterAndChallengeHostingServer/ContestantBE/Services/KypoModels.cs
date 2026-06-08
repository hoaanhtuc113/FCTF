namespace ContestantBE.Services;

/// <summary>
/// Ánh xạ raw SQL từ bảng kypo_challenge_configs.
/// Tên property = tên cột SQL (snake_case) để EF SqlQueryRaw map tự động.
/// Dùng chung bởi KypoScoreLockService và ChallengeController.
/// </summary>
public class KypoChallengeConfig
{
    public int     id                { get; set; }
    public int     challenge_id      { get; set; }
    public int     kypo_instance_id  { get; set; }
    public string? kypo_access_token  { get; set; }
    public string? kypo_instance_type { get; set; }
    public string? kypo_base_url      { get; set; }
}

/// <summary>
/// Ánh xạ raw SQL từ bảng kypo_team_accounts.
/// Tên property = tên cột SQL (snake_case) để EF SqlQueryRaw map tự động.
/// Dùng chung bởi KypoScoreLockService và ChallengeController.
/// </summary>
public class KypoTeamAccount
{
    public int     id            { get; set; }
    public int     team_id       { get; set; }
    public string? kypo_user_id  { get; set; }
    public string? kypo_username { get; set; }
    public string? kypo_password { get; set; }
}

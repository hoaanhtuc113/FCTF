using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Score;
using ResourceShared.Models;

namespace ResourceShared.Utils;

public class ScoreHelper
{
    private readonly ConfigHelper _configHelper;
    private readonly AppDbContext _context;

    public ScoreHelper(
        AppDbContext context,
        ConfigHelper configHelper)
    {
        _context = context;
        _configHelper = configHelper;
    }

    public async Task<Dictionary<User, int>> GetUsersScore(
        ICollection<User> users,
        bool admin = false)
    {
        if (users == null || users.Count == 0) return [];

        var userIds = users.Select(u => u.Id).ToList();

        DateTime? freeze = null;
        if (!admin)
        {
            var freezeConfig = await _context.Configs
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Key == "freeze");

            if (freezeConfig != null &&
                int.TryParse(freezeConfig.Value, out var freezeTs))
            {
                freeze = DateTimeOffset
                    .FromUnixTimeSeconds(freezeTs)
                    .UtcDateTime;
            }
        }

        // ========== SOLVES ==========
        var solvesScores = await _context.Solves
            .AsNoTracking()
            .Where(s =>
                userIds.Contains(s.UserId ?? 0) &&
                (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
            .GroupBy(s => s.UserId)
            .Select(g => new
            {
                UserId = g.Key ?? 0,
                Score = g.Sum(s => s.Challenge.Value ?? 0)
            })
            .ToDictionaryAsync(x => x.UserId, x => x.Score);

        // ========== AWARDS ==========
        var awardsScores = await _context.Awards
            .AsNoTracking()
            .Where(a =>
                userIds.Contains(a.UserId ?? 0) &&
                (!freeze.HasValue || a.Date < freeze.Value))
            .GroupBy(a => a.UserId)
            .Select(g => new
            {
                UserId = g.Key ?? 0,
                Score = g.Sum(a => a.Value ?? 0)
            })
            .ToDictionaryAsync(x => x.UserId, x => x.Score);

        // ========== MERGE ==========
        var result = new Dictionary<User, int>(users.Count);

        foreach (var u in users)
        {
            solvesScores.TryGetValue(u.Id, out var solve);
            awardsScores.TryGetValue(u.Id, out var award);

            result[u] = solve + award;
        }

        return result;
    }

    public async Task<int?> GetUserPlace(User user, bool admin = false)
    {
        DateTime? freeze = null;
        if (!admin)
        {
            var freezeConfig = await _context.Configs
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Key == "freeze");
            if (freezeConfig != null && int.TryParse(freezeConfig.Value, out var freezeTs))
                freeze = DateTimeOffset.FromUnixTimeSeconds(freezeTs).UtcDateTime;
        }

        // Get all user IDs first
        var userIds = await _context.Users
            .AsNoTracking()
            .Select(u => u.Id)
            .ToListAsync();

        // Calculate solves in bulk
        var solvesScores = await _context.Solves
            .AsNoTracking()
            .Where(s => userIds.Contains(s.UserId.Value) &&
                       (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
            .GroupBy(s => s.UserId)
            .Select(g => new { UserId = g.Key.Value, Score = g.Sum(s => (int?)(s.Challenge.Value) ?? 0) })
            .ToDictionaryAsync(x => x.UserId, x => x.Score);

        // Calculate awards in bulk
        var awardsScores = await _context.Awards
            .AsNoTracking()
            .Where(a => userIds.Contains(a.UserId.Value) &&
                       (!freeze.HasValue || a.Date < freeze.Value))
            .GroupBy(a => a.UserId)
            .Select(g => new { UserId = g.Key.Value, Score = g.Sum(a => (int?)a.Value ?? 0) })
            .ToDictionaryAsync(x => x.UserId, x => x.Score);

        // Combine scores in memory
        var scores = userIds.Select(id => new
        {
            Id = id,
            Score = (solvesScores.ContainsKey(id) ? solvesScores[id] : 0) +
                   (awardsScores.ContainsKey(id) ? awardsScores[id] : 0)
        }).ToList();

        var standings = scores
            .OrderByDescending(x => x.Score)
            .Select((x, idx) => new { x.Id, Place = idx + 1 })
            .ToList();

        var current = standings.FirstOrDefault(x => x.Id == user.Id);
        return current?.Place;

    }

    public async Task<int> GetTeamScore(Team team, bool admin = false)
    {

        DateTime? freeze = null;
        if (!admin)
        {
            var freezeConfig = await _context.Configs
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Key == "freeze");
            if (freezeConfig != null && int.TryParse(freezeConfig.Value, out var freezeTs))
                freeze = DateTimeOffset.FromUnixTimeSeconds(freezeTs).UtcDateTime;
        }

        // First get team member IDs to simplify the query
        var teamMemberIds = await _context.Users
            .AsNoTracking()
            .Where(u => u.TeamId == team.Id)
            .Select(u => u.Id)
            .ToListAsync();

        if (teamMemberIds.Count == 0)
            return 0;

        // Calculate solves score (remove unnecessary Include)
        var solvesScore = await _context.Solves
            .AsNoTracking()
            .Where(s => teamMemberIds.Contains(s.UserId.Value) &&
                       (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
            .SumAsync(s => (int?)(s.Challenge != null ? s.Challenge.Value : 0) ?? 0);

        // Calculate awards score
        var awardsScore = await _context.Awards
            .AsNoTracking()
            .Where(a => teamMemberIds.Contains(a.UserId.Value) &&
                       (!freeze.HasValue || a.Date < freeze.Value))
            .SumAsync(a => a.Value ?? 0);

        return solvesScore + awardsScore;
    }

    public async Task<List<Solf>> GetUserSolves(User user, bool admin = false)
    {

        var query = _context.Solves
            .AsNoTracking()
            .Where(s => s.UserId == user.Id)
            .OrderByDescending(s => s.IdNavigation.Date)
            .AsQueryable();

        var freezeConfig = _configHelper.GetConfig<long>("freeze", -1);
        if (freezeConfig != -1 && !admin)
        {
            DateTime dt = new DateTime(freezeConfig);
            query = query.Where(s => s.IdNavigation.Date < dt);
        }

        return await query.ToListAsync();

    }

    public async Task<List<Solf>> GetTeamSolves(Team team, bool admin = false)
    {

        // First get team member IDs to avoid complex navigation in LINQ
        var teamMemberIds = await _context.Users
            .AsNoTracking()
            .Where(u => u.TeamId == team.Id)
            .Select(u => u.Id)
            .ToListAsync();

        if (!teamMemberIds.Any())
            return new List<Solf>();

        var query = _context.Solves
            .AsNoTracking()
            .Include(s => s.IdNavigation)
            .Include(s => s.Challenge)
            .Include(s => s.User)
            .ThenInclude(u => u.Team)
            .Where(s => s.UserId.HasValue && teamMemberIds.Contains(s.UserId.Value))
            .OrderByDescending(s => s.IdNavigation.Date)
            .AsQueryable();

        var freezeConfig = _configHelper.GetConfig<long>("freeze", -1);

        if (freezeConfig != -1 && !admin)
        {
            DateTime dt = new DateTime(freezeConfig);
            query = query.Where(s => s.IdNavigation.Date < dt);
        }

        return await query.ToListAsync();

    }

    public async Task<int?> GetTeamPlace(Team team, bool admin = false, int? bracketId = null)
    {
        DateTime? freeze = null;
        if (!admin)
        {
            var freezeConfig = await _context.Configs
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Key == "freeze");
            if (freezeConfig != null && int.TryParse(freezeConfig.Value, out var freezeTs))
                freeze = DateTimeOffset.FromUnixTimeSeconds(freezeTs).UtcDateTime;
        }

        // Get all teams with their member IDs in one query, optionally filtered by bracket
        var teamsQuery = _context.Teams.AsNoTracking();
        if (bracketId.HasValue)
            teamsQuery = teamsQuery.Where(t => t.BracketId == bracketId.Value);

        var teamsWithMembers = await teamsQuery
            .Select(t => new
            {
                TeamId = t.Id,
                MemberIds = t.Users.Select(u => u.Id).ToList()
            })
            .ToListAsync();

        // Get all user IDs
        var allUserIds = teamsWithMembers.SelectMany(t => t.MemberIds).Distinct().ToList();

        // Calculate solves in bulk for ALL teams at once
        var solvesScores = await _context.Solves
            .AsNoTracking()
            .Where(s => allUserIds.Contains(s.UserId.Value) &&
                       (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
            .GroupBy(s => s.UserId)
            .Select(g => new { UserId = g.Key.Value, Score = g.Sum(s => (int?)(s.Challenge.Value) ?? 0) })
            .ToDictionaryAsync(x => x.UserId, x => x.Score);

        // Calculate awards in bulk for ALL teams at once
        var awardsScores = await _context.Awards
            .AsNoTracking()
            .Where(a => allUserIds.Contains(a.UserId.Value) &&
                       (!freeze.HasValue || a.Date < freeze.Value))
            .GroupBy(a => a.UserId)
            .Select(g => new { UserId = g.Key.Value, Score = g.Sum(a => (int?)a.Value ?? 0) })
            .ToDictionaryAsync(x => x.UserId, x => x.Score);

        // Calculate team scores in memory
        var teamScores = teamsWithMembers.Select(teamInfo =>
        {
            var score = teamInfo.MemberIds.Sum(memberId =>
                (solvesScores.ContainsKey(memberId) ? solvesScores[memberId] : 0) +
                (awardsScores.ContainsKey(memberId) ? awardsScores[memberId] : 0)
            );
            return (TeamId: teamInfo.TeamId, Score: score);
        }).ToList();

        var standings = teamScores
            .OrderByDescending(x => x.Score)
            .Select((x, idx) => new { x.TeamId, Place = idx + 1 })
            .ToList();

        var current = standings.FirstOrDefault(x => x.TeamId == team.Id);
        return current?.Place;

    }
    private long ToLong(object val)
    {
        if (val == null) return 0;
        if (long.TryParse(val.ToString(), out var result))
        {
            return result;
        }

        return 0;
    }
    public async Task<List<StandingDto>> GetStandings(
        int? count = null,
        int? bracketId = null,
        bool admin = false)
    {
        var freeze = ToLong(_configHelper.GetConfig("freeze"));
        DateTime? freezeUtc = freeze > 0
            ? DateTimeOffset.FromUnixTimeSeconds(freeze).UtcDateTime
            : null;

        var userMode = _configHelper.GetConfig<string>("user_mode") ?? "teams";

        return userMode == "teams"
            ? await GetTeamStandings(count, bracketId, admin, freezeUtc)
            : await GetUserStandings(count, bracketId, admin, freezeUtc);
    }

    private async Task<List<StandingDto>> GetTeamStandings(
        int? count, int? bracketId, bool admin, DateTime? freezeUtc)
    {
        // Materialize solve scores per team (explicit JOIN, no navigation inside GroupBy)
        var solveQuery =
            from solve in _context.Solves
            join challenge in _context.Challenges on solve.ChallengeId equals challenge.Id
            join submission in _context.Submissions on solve.Id equals submission.Id
            where solve.TeamId != null && (challenge.Value ?? 0) != 0
            select new { solve.TeamId, ChallengeValue = challenge.Value ?? 0, solve.Id, submission.Date };

        if (!admin && freezeUtc.HasValue)
            solveQuery = solveQuery.Where(x => x.Date < freezeUtc.Value);

        var solvesByTeam = await solveQuery
            .GroupBy(x => x.TeamId)
            .Select(g => new
            {
                TeamId = g.Key!.Value,
                Score = g.Sum(x => x.ChallengeValue),
                LastId = g.Max(x => x.Id),
                LastDate = (DateTime?)g.Max(x => x.Date)
            })
            .ToListAsync();

        // Materialize award scores per team separately
        var awardQuery = _context.Awards
            .Where(a => a.TeamId != null && (a.Value ?? 0) != 0);

        if (!admin && freezeUtc.HasValue)
            awardQuery = awardQuery.Where(a => a.Date < freezeUtc.Value);

        var awardsByTeam = await awardQuery
            .GroupBy(a => a.TeamId)
            .Select(g => new
            {
                TeamId = g.Key!.Value,
                Score = g.Sum(x => x.Value ?? 0),
                LastId = g.Max(x => x.Id),
                LastDate = (DateTime?)g.Max(x => x.Date)
            })
            .ToListAsync();

        // Combine in memory
        var scoreMap = new Dictionary<int, (int Score, int LastId, DateTime? LastDate)>();
        foreach (var s in solvesByTeam)
            scoreMap[s.TeamId] = (s.Score, s.LastId, s.LastDate);
        foreach (var a in awardsByTeam)
        {
            if (scoreMap.TryGetValue(a.TeamId, out var e))
                scoreMap[a.TeamId] = (e.Score + a.Score, Math.Max(e.LastId, a.LastId),
                    e.LastDate > a.LastDate ? e.LastDate : a.LastDate);
            else
                scoreMap[a.TeamId] = (a.Score, a.LastId, a.LastDate);
        }

        var scoredTeamIds = scoreMap.Keys.ToList();

        // Load teams that have scores
        var teamsQuery = _context.Teams
            .AsNoTracking()
            .Where(t => scoredTeamIds.Contains(t.Id));

        if (!admin)
            teamsQuery = teamsQuery.Where(t => !(t.Hidden ?? false) && !(t.Banned ?? false));

        if (bracketId.HasValue)
            teamsQuery = teamsQuery.Where(t => t.BracketId == bracketId.Value);

        var teams = await teamsQuery
            .Select(t => new { t.Id, t.OauthId, t.Name, t.BracketId, t.Hidden, t.Banned })
            .ToListAsync();

        // Load bracket names in bulk
        var bracketIds = teams.Where(t => t.BracketId.HasValue)
            .Select(t => t.BracketId!.Value).Distinct().ToList();
        var bracketNames = bracketIds.Any()
            ? await _context.Brackets
                .Where(b => bracketIds.Contains(b.Id))
                .ToDictionaryAsync(b => b.Id, b => b.Name)
            : new Dictionary<int, string?>();

        var result = teams
            .Select(t =>
            {
                var s = scoreMap.TryGetValue(t.Id, out var sc) ? sc : (Score: 0, LastId: 0, LastDate: (DateTime?)null);
                return new StandingDto
                {
                    AccountId = t.Id,
                    OauthId = t.OauthId,
                    Name = t.Name,
                    BracketId = t.BracketId,
                    BracketName = t.BracketId.HasValue && bracketNames.TryGetValue(t.BracketId.Value, out var bn) ? bn : null,
                    Score = s.Score,
                    LastId = s.LastId,
                    LastDate = s.LastDate,
                    Hidden = t.Hidden,
                    Banned = t.Banned
                };
            })
            .OrderByDescending(x => x.Score)
            .ThenBy(x => x.LastDate)
            .ThenBy(x => x.LastId)
            .ToList();

        return count.HasValue ? result.Take(count.Value).ToList() : result;
    }

    private async Task<List<StandingDto>> GetUserStandings(
        int? count, int? bracketId, bool admin, DateTime? freezeUtc)
    {
        var solveQuery =
            from solve in _context.Solves
            join challenge in _context.Challenges on solve.ChallengeId equals challenge.Id
            join submission in _context.Submissions on solve.Id equals submission.Id
            where solve.UserId != null && (challenge.Value ?? 0) != 0
            select new { solve.UserId, ChallengeValue = challenge.Value ?? 0, solve.Id, submission.Date };

        if (!admin && freezeUtc.HasValue)
            solveQuery = solveQuery.Where(x => x.Date < freezeUtc.Value);

        var solvesByUser = await solveQuery
            .GroupBy(x => x.UserId)
            .Select(g => new
            {
                UserId = g.Key!.Value,
                Score = g.Sum(x => x.ChallengeValue),
                LastId = g.Max(x => x.Id),
                LastDate = (DateTime?)g.Max(x => x.Date)
            })
            .ToListAsync();

        var awardQuery = _context.Awards
            .Where(a => a.UserId != null && (a.Value ?? 0) != 0);

        if (!admin && freezeUtc.HasValue)
            awardQuery = awardQuery.Where(a => a.Date < freezeUtc.Value);

        var awardsByUser = await awardQuery
            .GroupBy(a => a.UserId)
            .Select(g => new
            {
                UserId = g.Key!.Value,
                Score = g.Sum(x => x.Value ?? 0),
                LastId = g.Max(x => x.Id),
                LastDate = (DateTime?)g.Max(x => x.Date)
            })
            .ToListAsync();

        var scoreMap = new Dictionary<int, (int Score, int LastId, DateTime? LastDate)>();
        foreach (var s in solvesByUser)
            scoreMap[s.UserId] = (s.Score, s.LastId, s.LastDate);
        foreach (var a in awardsByUser)
        {
            if (scoreMap.TryGetValue(a.UserId, out var e))
                scoreMap[a.UserId] = (e.Score + a.Score, Math.Max(e.LastId, a.LastId),
                    e.LastDate > a.LastDate ? e.LastDate : a.LastDate);
            else
                scoreMap[a.UserId] = (a.Score, a.LastId, a.LastDate);
        }

        var scoredUserIds = scoreMap.Keys.ToList();

        var usersQuery = _context.Users
            .AsNoTracking()
            .Where(u => scoredUserIds.Contains(u.Id));

        if (!admin)
            usersQuery = usersQuery.Where(u => !(u.Hidden ?? false) && !(u.Banned ?? false));

        if (bracketId.HasValue)
            usersQuery = usersQuery.Where(u => u.BracketId == bracketId.Value);

        var users = await usersQuery
            .Select(u => new { u.Id, u.OauthId, u.Name, u.BracketId, u.Hidden, u.Banned })
            .ToListAsync();

        var result = users
            .Select(u =>
            {
                var s = scoreMap.TryGetValue(u.Id, out var sc) ? sc : (Score: 0, LastId: 0, LastDate: (DateTime?)null);
                return new StandingDto
                {
                    AccountId = u.Id,
                    OauthId = u.OauthId,
                    Name = u.Name,
                    BracketId = u.BracketId,
                    BracketName = null,
                    Score = s.Score,
                    LastId = s.LastId,
                    LastDate = s.LastDate,
                    Hidden = u.Hidden,
                    Banned = u.Banned
                };
            })
            .OrderByDescending(x => x.Score)
            .ThenBy(x => x.LastDate)
            .ThenBy(x => x.LastId)
            .ToList();

        return count.HasValue ? result.Take(count.Value).ToList() : result;
    }

}
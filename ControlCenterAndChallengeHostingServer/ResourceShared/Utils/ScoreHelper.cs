using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Score;
using ResourceShared.Models;
using StackExchange.Redis;
using System.Linq;

namespace ResourceShared.Utils
{
    public class ScoreHelper
    {
        private readonly DbContextOptions<AppDbContext> dbOptions;
        private readonly AppDbContext _context;
        private readonly ConfigHelper configHelper;

        public ScoreHelper(DbContextOptions<AppDbContext> options, ConfigHelper config, AppDbContext appContext)
        {
            dbOptions = options;
            configHelper = config;
            _context = appContext;
        }

        public async Task<int> GetUserScore(User user, bool admin = false)
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

            // Single query to calculate both scores
            var solvesScore = await _context.Solves
                .AsNoTracking()
                .Where(s => s.UserId == user.Id && (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
                .SumAsync(s => (int?)(s.Challenge != null ? s.Challenge.Value : 0) ?? 0);

            var awardsScore = await _context.Awards
                .AsNoTracking()
                .Where(a => a.UserId == user.Id && (!freeze.HasValue || a.Date < freeze.Value))
                .SumAsync(a => (int?)a.Value ?? 0);

            return solvesScore + awardsScore;
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

            if (!teamMemberIds.Any())
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
                .SumAsync(a => (int?)a.Value ?? 0);

            return solvesScore + awardsScore;
        }

        public async Task<List<Solf>> GetUserSolves(User user, bool admin = false)
        {
            var query = _context.Solves
                .AsNoTracking()
                .Where(s => s.UserId == user.Id)
                .OrderByDescending(s => s.IdNavigation.Date)
                .AsQueryable();

            var freezeConfig = configHelper.GetConfig<long>("freeze", -1);
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

            var freezeConfig = configHelper.GetConfig<long>("freeze", -1);

            if (freezeConfig != -1 && !admin)
            {
                DateTime dt = new DateTime(freezeConfig);
                query = query.Where(s => s.IdNavigation.Date < dt);
            }

            return await query.ToListAsync();
        }

        public async Task<int?> GetTeamPlace(Team team, bool admin = false)
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

            // Get all teams with their member IDs in one query
            var teamsWithMembers = await _context.Teams
                .AsNoTracking()
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
            var teamScores = teamsWithMembers.Select(teamInfo => {
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
            using var _context = new AppDbContext(dbOptions);

            var freeze = ToLong(configHelper.GetConfig("freeze"));
            DateTime? freezeUtc = freeze > 0
                ? DateTimeOffset.FromUnixTimeSeconds(freeze).UtcDateTime
                : null;

            var userMode = configHelper.GetConfig<string>("user_mode") ?? "teams";

            IQueryable<StandingDto> query;

            if (userMode == "teams")
            {
                // ===== Solves =====
                var solveScores = _context.Solves
                    .Include(s => s.Challenge)
                    .Where(s => s.Challenge.Value != 0);

                if (!admin && freezeUtc.HasValue)
                    solveScores = solveScores.Where(s => s.IdNavigation.Date < freezeUtc.Value);

                var scoresGroup = solveScores
                    .GroupBy(s => s.TeamId)
                    .Select(g => new
                    {
                        account_id = g.Key,
                        Score = g.Sum(x => x.Challenge.Value),
                        id = g.Max(x => x.Id),
                        date = g.Max(x => x.IdNavigation.Date)
                    });

                // ===== Awards =====
                var awardScores = _context.Awards
                    .Where(a => a.Value != 0);

                if (!admin && freezeUtc.HasValue)
                    awardScores = awardScores.Where(a => a.Date < freezeUtc.Value);

                var awardsGroup = awardScores
                    .GroupBy(a => a.TeamId)
                    .Select(g => new
                    {
                        account_id = g.Key,
                        Score = g.Sum(x => x.Value),
                        id = g.Max(x => x.Id),
                        date = g.Max(x => x.Date)
                    });

                // ===== Combine & Sum =====
                var combined = scoresGroup.Concat(awardsGroup);

                var sumScores = combined
                    .GroupBy(x => x.account_id)
                    .Select(g => new
                    {
                        account_id = g.Key,
                        Score = g.Sum(x => x.Score),
                        LastId = g.Max(x => x.id),
                        LastDate = g.Max(x => x.date)
                    });

                query = from acc in _context.Teams
                        join s in sumScores on acc.Id equals s.account_id
                        join b in _context.Brackets on acc.BracketId equals b.Id into bj
                        from bracket in bj.DefaultIfEmpty()
                        select new StandingDto
                        {
                            AccountId = acc.Id,
                            OauthId = acc.OauthId,
                            Name = acc.Name,
                            BracketId = acc.BracketId,
                            BracketName = bracket != null ? bracket.Name : null,
                            Score = s.Score,
                            LastId = s.LastId,
                            LastDate = s.LastDate,
                            Hidden = acc.Hidden,
                            Banned = acc.Banned
                        };
            }
            else // ===== Users =====
            {
                var solveScores = _context.Solves
                    .Include(s => s.Challenge)
                    .Where(s => s.Challenge.Value != 0);

                if (!admin && freezeUtc.HasValue)
                    solveScores = solveScores.Where(s => s.IdNavigation.Date < freezeUtc.Value);

                var scoresGroup = solveScores
                    .GroupBy(s => s.UserId)
                    .Select(g => new
                    {
                        account_id = g.Key,
                        Score = g.Sum(x => x.Challenge.Value),
                        id = g.Max(x => x.Id),
                        date = g.Max(x => x.IdNavigation.Date)
                    });

                var awardScores = _context.Awards
                    .Where(a => a.Value != 0);

                if (!admin && freezeUtc.HasValue)
                    awardScores = awardScores.Where(a => a.Date < freezeUtc.Value);

                var awardsGroup = awardScores
                    .GroupBy(a => a.UserId)
                    .Select(g => new
                    {
                        account_id = g.Key,
                        Score = g.Sum(x => x.Value),
                        id = g.Max(x => x.Id),
                        date = g.Max(x => x.Date)
                    });

                var combined = scoresGroup.Concat(awardsGroup);

                var sumScores = combined
                    .GroupBy(x => x.account_id)
                    .Select(g => new
                    {
                        account_id = g.Key,
                        Score = g.Sum(x => x.Score),
                        LastId = g.Max(x => x.id),
                        LastDate = g.Max(x => x.date)
                    });

                query = from acc in _context.Users
                        join s in sumScores on acc.Id equals s.account_id
                        select new StandingDto
                        {
                            AccountId = acc.Id,
                            OauthId = acc.OauthId,
                            Name = acc.Name,
                            BracketId = acc.BracketId,
                            BracketName = null,
                            Score = s.Score,
                            LastId = s.LastId,
                            LastDate = s.LastDate,
                            Hidden = acc.Hidden,
                            Banned = acc.Banned
                        };
            }

            // ===== Filters =====
            if (!admin)
                query = query.Where(x => !(x.Banned ?? false) && !(x.Hidden ?? false));

            if (bracketId.HasValue)
                query = query.Where(x => x.BracketId == bracketId.Value);

            query = query
                .OrderByDescending(x => x.Score)
                .ThenBy(x => x.LastDate)
                .ThenBy(x => x.LastId);

            return count.HasValue
                ? await query.Take(count.Value).ToListAsync()
                : await query.ToListAsync();
        }

    }
}
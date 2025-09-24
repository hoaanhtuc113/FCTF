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
        private readonly ConfigHelper configHelper;

        public ScoreHelper(DbContextOptions<AppDbContext> options, ConfigHelper config)
        {
            dbOptions = options;
            configHelper = config;
        }

        public async Task<int> GetUserScore(User user, bool admin = false)
        {
            using var dbContext = new AppDbContext(dbOptions);

            DateTime? freeze = null;
            if (!admin)
            {
                var freezeConfig = await dbContext.Configs.FirstOrDefaultAsync(c => c.Key == "freeze");
                if (freezeConfig != null && int.TryParse(freezeConfig.Value, out var freezeTs))
                    freeze = DateTimeOffset.FromUnixTimeSeconds(freezeTs).UtcDateTime;
            }

            // Use a single query to get both solves and awards
            var userScoreData = await dbContext.Users
                .Where(u => u.Id == user.Id)
                .Select(u => new
                {
                    SolvesScore = dbContext.Solves
                        .Where(s => s.UserId == u.Id && (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
                        .Sum(s => (int?)(s.Challenge != null ? s.Challenge.Value : 0) ?? 0),
                    AwardsScore = dbContext.Awards
                        .Where(a => a.UserId == u.Id && (!freeze.HasValue || a.Date < freeze.Value))
                        .Sum(a => (int?)a.Value ?? 0)
                })
                .FirstOrDefaultAsync();

            if (userScoreData == null)
                return 0;

            return userScoreData.SolvesScore + userScoreData.AwardsScore;
        }

        public async Task<int?> GetUserPlace(User user, bool admin = false)
        {
            using var dbContext = new AppDbContext(dbOptions);

            DateTime? freeze = null;
            if (!admin)
            {
                var freezeConfig = await dbContext.Configs.FirstOrDefaultAsync(c => c.Key == "freeze");
                if (freezeConfig != null && int.TryParse(freezeConfig.Value, out var freezeTs))
                    freeze = DateTimeOffset.FromUnixTimeSeconds(freezeTs).UtcDateTime;
            }

            var scores = await dbContext.Users
                .Select(u => new
                {
                    u.Id,
                    Score =
                        (dbContext.Solves.Where(s => s.UserId == u.Id && (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
                                  .Sum(s => (int?)s.Challenge.Value) ?? 0)
                      +
                        (dbContext.Awards.Where(a => a.UserId == u.Id && (!freeze.HasValue || a.Date < freeze.Value))
                                  .Sum(a => (int?)a.Value) ?? 0)
                })
                .ToListAsync();

            var standings = scores
                .OrderByDescending(x => x.Score)
                .Select((x, idx) => new { x.Id, Place = idx + 1 })
                .ToList();

            var current = standings.FirstOrDefault(x => x.Id == user.Id);
            return current?.Place;
        }

        public async Task<int> GetTeamScore(Team team, bool admin = false)
        {
            using var dbContext = new AppDbContext(dbOptions);

            DateTime? freeze = null;
            if (!admin)
            {
                var freezeConfig = await dbContext.Configs.FirstOrDefaultAsync(c => c.Key == "freeze");
                if (freezeConfig != null && int.TryParse(freezeConfig.Value, out var freezeTs))
                    freeze = DateTimeOffset.FromUnixTimeSeconds(freezeTs).UtcDateTime;
            }

            // First get team member IDs to simplify the query
            var teamMemberIds = await dbContext.Users
                .Where(u => u.TeamId == team.Id)
                .Select(u => u.Id)
                .ToListAsync();

            if (!teamMemberIds.Any())
                return 0;

            // Calculate solves score
            var solvesScore = await dbContext.Solves
                .Where(s => teamMemberIds.Contains(s.UserId.Value) &&
                           (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
                .Include(s => s.Challenge)
                .SumAsync(s => (int?)(s.Challenge != null ? s.Challenge.Value : 0) ?? 0);

            // Calculate awards score
            var awardsScore = await dbContext.Awards
                .Where(a => teamMemberIds.Contains(a.UserId.Value) &&
                           (!freeze.HasValue || a.Date < freeze.Value))
                .SumAsync(a => (int?)a.Value ?? 0);

            return solvesScore + awardsScore;
        }

        public async Task<List<Solf>> GetUserSolves(User user, bool admin = false)
        {
            using var dbContext = new AppDbContext(dbOptions);

            var query = dbContext.Solves
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
            using var dbContext = new AppDbContext(dbOptions);

            // First get team member IDs to avoid complex navigation in LINQ
            var teamMemberIds = await dbContext.Users
                .Where(u => u.TeamId == team.Id)
                .Select(u => u.Id)
                .ToListAsync();

            if (!teamMemberIds.Any())
                return new List<Solf>();

            var query = dbContext.Solves
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
            using var dbContext = new AppDbContext(dbOptions);

            DateTime? freeze = null;
            if (!admin)
            {
                var freezeConfig = await dbContext.Configs.FirstOrDefaultAsync(c => c.Key == "freeze");
                if (freezeConfig != null && int.TryParse(freezeConfig.Value, out var freezeTs))
                    freeze = DateTimeOffset.FromUnixTimeSeconds(freezeTs).UtcDateTime;
            }

            // Get all teams with their member IDs first
            var teamsWithMembers = await dbContext.Teams
                .Select(t => new
                {
                    TeamId = t.Id,
                    MemberIds = t.Users.Select(u => u.Id).ToList()
                })
                .ToListAsync();

            var teamScores = new List<(int TeamId, int Score)>();

            // Calculate scores for each team
            foreach (var teamInfo in teamsWithMembers)
            {
                if (!teamInfo.MemberIds.Any())
                {
                    teamScores.Add((teamInfo.TeamId, 0));
                    continue;
                }

                var solvesScore = await dbContext.Solves
                    .Where(s => teamInfo.MemberIds.Contains(s.UserId.Value) &&
                               (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
                    .Include(s => s.Challenge)
                    .SumAsync(s => (int?)(s.Challenge != null ? s.Challenge.Value : 0) ?? 0);

                var awardsScore = await dbContext.Awards
                    .Where(a => teamInfo.MemberIds.Contains(a.UserId.Value) &&
                               (!freeze.HasValue || a.Date < freeze.Value))
                    .SumAsync(a => (int?)a.Value ?? 0);

                teamScores.Add((teamInfo.TeamId, solvesScore + awardsScore));
            }

            var standings = teamScores
                .OrderByDescending(x => x.Score)
                .Select((x, idx) => new { x.TeamId, Place = idx + 1 })
                .ToList();

            var current = standings.FirstOrDefault(x => x.TeamId == team.Id);
            return current?.Place;
        }
        public async Task<List<StandingDto>> GetStandings(int? count = null, int? bracketId = null, bool admin = false)
        {
            using var _context = new AppDbContext(dbOptions);

            var freeze = configHelper.GetConfig<long?>("freeze");
            DateTime? freezeUtc = null;
            if (freeze.HasValue)
                freezeUtc = DateTimeOffset.FromUnixTimeSeconds(freeze.Value).UtcDateTime;


            var solveScores = _context.Solves
                .Include(s => s.Challenge)
                .Where(s => s.Challenge.Value != 0)
                .AsQueryable();

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
            var awardScores = _context.Awards
                .Where(a => a.Value != 0)
                .AsQueryable();

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
            var query = from acc in _context.Teams
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

            if (!admin)
            {
                query = query.Where(x => !x.Banned.Value && !x.Hidden.Value);
            }

            if (bracketId.HasValue)
            {
                query = query.Where(x => x.BracketId == bracketId.Value);
            }

            query = query
                .OrderByDescending(x => x.Score)
                .ThenBy(x => x.LastDate)
                .ThenBy(x => x.LastId);

            if (count.HasValue)
                return await query.Take(count.Value).ToListAsync();
            else
                return await query.ToListAsync();
        }
    }
}
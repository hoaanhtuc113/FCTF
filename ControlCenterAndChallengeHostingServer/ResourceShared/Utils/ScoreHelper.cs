using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ResourceShared.Utils
{
    public class ScoreHelper
    {
        public readonly AppDbContext db;
        public ScoreHelper(AppDbContext context)
        {
            db = context;
        }
        public async Task<int> GetUserScore(User user, bool admin = false)
        {
            DateTime? freeze = null;
            if (!admin)
            {
                var freezeConfig = await db.Configs.FirstOrDefaultAsync(c => c.Key == "freeze");
                if (freezeConfig != null && int.TryParse(freezeConfig.Value, out var freezeTs))
                    freeze = DateTimeOffset.FromUnixTimeSeconds(freezeTs).UtcDateTime;
            }

            var solveQuery = db.Solves
                .Where(s => s.UserId == user.Id)
                .Include(s => s.Challenge);

            if (freeze.HasValue)
                solveQuery = (Microsoft.EntityFrameworkCore.Query.IIncludableQueryable<Solf, Challenge?>)solveQuery.Where(s => s.IdNavigation.Date < freeze.Value);

            //var solveScore = await solveQuery.SumAsync(s => (int?)s.Challenge.Value ?? 0);
            var solveScore = await solveQuery.SumAsync(s => (int?)(s.Challenge != null ? s.Challenge.Value : 0) ?? 0);

            var awardQuery = db.Awards.Where(a => a.UserId == user.Id);
            if (freeze.HasValue)
                awardQuery = awardQuery.Where(a => a.Date < freeze.Value);

            var awardScore = await awardQuery.SumAsync(a => (int?)a.Value ?? 0);

            return solveScore + awardScore;
        }

        public async Task<int?> GetUserPlace(User user, bool admin = false)
        {
            DateTime? freeze = null;
            if (!admin)
            {
                var freezeConfig = await db.Configs.FirstOrDefaultAsync(c => c.Key == "freeze");
                if (freezeConfig != null && int.TryParse(freezeConfig.Value, out var freezeTs))
                    freeze = DateTimeOffset.FromUnixTimeSeconds(freezeTs).UtcDateTime;
            }

            var scores = await db.Users
                .Select(u => new
                {
                    u.Id,
                    Score =
                        (db.Solves.Where(s => s.UserId == u.Id && (!freeze.HasValue || s.IdNavigation.Date < freeze.Value))
                                  .Sum(s => (int?)s.Challenge.Value) ?? 0)
                      +
                        (db.Awards.Where(a => a.UserId == u.Id && (!freeze.HasValue || a.Date < freeze.Value))
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
            var members = await db.Users
                                .Where(u => u.TeamId == team.Id)
                                .AsNoTracking()
                                .ToListAsync();

            int total = 0;

            foreach (var member in members)
            {
                total += await GetUserScore(member, admin);
            }

            return total;
        }

        public async Task<int?> GetTeamPlace(Team team, bool admin = false)
        {
            var teams = await db.Teams.ToListAsync();
            var scores = new List<(int TeamId, int Score)>();

            foreach (var t in teams)
            {
                var score = await GetTeamScore(t, admin);
                scores.Add((t.Id, score));
            }

            var standings = scores
                .OrderByDescending(x => x.Score)
                .Select((x, idx) => new { x.TeamId, Place = idx + 1 })
                .ToList();

            var current = standings.FirstOrDefault(x => x.TeamId == team.Id);
            return current?.Place;
        }
    }
}

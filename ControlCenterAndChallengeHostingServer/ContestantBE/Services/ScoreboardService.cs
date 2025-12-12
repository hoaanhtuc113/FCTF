using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Score;
using ResourceShared.Models;
using ResourceShared.Utils;
using ResourceShared.Logger;

namespace ContestantBE.Services
{
    public class ScoreboardService : IScoreboardService
    {
        private readonly AppDbContext _context;
        private readonly ConfigHelper _configHelper;
        private readonly ScoreHelper _scoreHelper;
        private readonly AppLogger _logger;
        private readonly string _mode;

        public ScoreboardService(AppDbContext context, ConfigHelper configHelper, ScoreHelper scoreHelper, AppLogger logger)
        {
            _context = context;
            _configHelper = configHelper;
            _scoreHelper = scoreHelper;
            _logger = logger;
            _mode = _configHelper.UserMode() ?? "teams";
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
        private int? GetAccountId(Solf solve) =>
            _mode == "teams" ? solve.TeamId : solve.UserId;

        private int? GetAccountId(Award award) =>
            _mode == "teams" ? award.TeamId : award.UserId;

        public async Task<List<ScoreboardEntryDTO>> GetTopStandings(int count, int? bracketId)
        {
            try
            {
                var standings = await _scoreHelper.GetStandings(count, bracketId);
                var accountIds = standings.Select(t => t.AccountId).ToList();
                IQueryable<Solf> solvesQuery;
                IQueryable<Award> awardsQuery;

                if (_mode == "teams")
                {
                    solvesQuery = _context.Solves.Where(s => s.TeamId.HasValue && accountIds.Contains(s.TeamId.Value));
                    awardsQuery = _context.Awards.Where(a => a.TeamId.HasValue && accountIds.Contains(a.TeamId.Value));
                }
                else
                {
                    solvesQuery = _context.Solves.Where(s => s.UserId.HasValue && accountIds.Contains(s.UserId.Value));
                    awardsQuery = _context.Awards.Where(a => a.UserId.HasValue && accountIds.Contains(a.UserId.Value));
                }

                // Freeze logic
                var freeze = ToLong(_configHelper.GetConfig("freeze"));
                if (freeze > 0)
                {
                    var freezeUtc = DateTimeOffset.FromUnixTimeSeconds(freeze).UtcDateTime;
                    solvesQuery = solvesQuery.Where(s => s.IdNavigation.Date < freezeUtc);
                    awardsQuery = awardsQuery.Where(a => a.Date < freezeUtc);
                }

                var solves = await solvesQuery
                    .Include(s => s.Challenge)
                    .Include(s => s.IdNavigation)
                    .ToListAsync();

                var awards = await awardsQuery.ToListAsync();

                var solvesMapper = new Dictionary<int, List<SolveEntryDTO>>();

                foreach (var solve in solves)
                {
                    var accId = GetAccountId(solve);
                    if (accId == null) continue;

                    if (!solvesMapper.ContainsKey(accId.Value))
                        solvesMapper[accId.Value] = new List<SolveEntryDTO>();

                    solvesMapper[accId.Value].Add(new SolveEntryDTO
                    {
                        ChallengeId = solve.ChallengeId,
                        AccountId = accId,
                        TeamId = solve.TeamId,
                        UserId = solve.UserId,
                        Value = solve.Challenge?.Value ?? 0,
                        Date = solve.IdNavigation.Date
                    });
                }

                foreach (var award in awards)
                {
                    var accId = GetAccountId(award);
                    if (accId == null) continue;

                    if (!solvesMapper.ContainsKey(accId.Value))
                        solvesMapper[accId.Value] = new List<SolveEntryDTO>();

                    solvesMapper[accId.Value].Add(new SolveEntryDTO
                    {
                        ChallengeId = null,
                        AccountId = accId,
                        TeamId = award.TeamId,
                        UserId = award.UserId,
                        Value = award.Value,
                        Date = award.Date
                    });
                }

                // Sort by date
                foreach (var key in solvesMapper.Keys.ToList())
                    solvesMapper[key] = solvesMapper[key].OrderBy(s => s.Date).ToList();

                // Build final response
                var result = new List<ScoreboardEntryDTO>();
                for (int i = 0; i < standings.Count; i++)
                {
                    var team = standings[i];
                    result.Add(new ScoreboardEntryDTO
                    {
                        Id = team.AccountId ?? 0,
                        AccountUrl = $"/{_mode}/{team.AccountId}",
                        Name = team.Name,
                        Score = (int)team.Score,
                        BracketId = team.BracketId,
                        BracketName = team.BracketName,
                        Solves = solvesMapper.ContainsKey(team.AccountId ?? 0) ? solvesMapper[team.AccountId ?? 0] : new List<SolveEntryDTO>()
                    });
                }

                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, data: new { value  = "GetTopStandings" });
                return new List<ScoreboardEntryDTO>();
            }
        }
    }
}

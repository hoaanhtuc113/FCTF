using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Score;
using ResourceShared.Models;
using ResourceShared.Utils;
using ResourceShared.Logger;

namespace ContestantBE.Services;

public class ScoreboardService : IScoreboardService
{
    private readonly AppDbContext _context;
    private readonly ConfigHelper _configHelper;
    private readonly ScoreHelper _scoreHelper;
    private readonly AppLogger _logger;
    private readonly string _mode;

    public ScoreboardService(
        AppDbContext context,
        ConfigHelper configHelper,
        ScoreHelper scoreHelper,
        AppLogger logger)
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

            List<SolveEntryDTO> solves;
            List<SolveEntryDTO> awards;

            if (_mode == "teams")
            {
                solves = await solvesQuery
                    .AsNoTracking()
                    .Select(s => new SolveEntryDTO
                    {
                        ChallengeId = s.ChallengeId,
                        AccountId = s.TeamId,
                        TeamId = s.TeamId,
                        UserId = s.UserId,
                        Value = s.Challenge != null ? s.Challenge.Value : 0,
                        Date = s.IdNavigation.Date
                    })
                    .ToListAsync();

                awards = await awardsQuery
                    .AsNoTracking()
                    .Select(a => new SolveEntryDTO
                    {
                        ChallengeId = null,
                        AccountId = a.TeamId,
                        TeamId = a.TeamId,
                        UserId = a.UserId,
                        Value = a.Value,
                        Date = a.Date
                    })
                    .ToListAsync();
            }
            else
            {
                solves = await solvesQuery
                    .AsNoTracking()
                    .Select(s => new SolveEntryDTO
                    {
                        ChallengeId = s.ChallengeId,
                        AccountId = s.UserId,
                        TeamId = s.TeamId,
                        UserId = s.UserId,
                        Value = s.Challenge != null ? s.Challenge.Value : 0,
                        Date = s.IdNavigation.Date
                    })
                    .ToListAsync();

                awards = await awardsQuery
                    .AsNoTracking()
                    .Select(a => new SolveEntryDTO
                    {
                        ChallengeId = null,
                        AccountId = a.UserId,
                        TeamId = a.TeamId,
                        UserId = a.UserId,
                        Value = a.Value,
                        Date = a.Date
                    })
                    .ToListAsync();
            }

            var solvesMapper = new Dictionary<int, List<SolveEntryDTO>>();

            foreach (var solve in solves)
            {
                var accId = solve.AccountId;
                if (accId == null) continue;

                if (!solvesMapper.ContainsKey(accId.Value))
                    solvesMapper[accId.Value] = [];

                solvesMapper[accId.Value].Add(solve);
            }

            foreach (var award in awards)
            {
                var accId = award.AccountId;
                if (accId == null) continue;

                if (!solvesMapper.ContainsKey(accId.Value))
                    solvesMapper[accId.Value] = new List<SolveEntryDTO>();

                solvesMapper[accId.Value].Add(award);
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
                    Solves = solvesMapper.ContainsKey(team.AccountId ?? 0) ? solvesMapper[team.AccountId ?? 0] : []
                });
            }

            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, data: new { value = "GetTopStandings" });
            return [];
        }
    }
}

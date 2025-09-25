using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Submit;
using ResourceShared.Models;
using ResourceShared.Utils;
using StackExchange.Redis;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ScoreboardController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly CtfTimeHelper _ctfTimeHelper;
        private readonly ConfigHelper _configHelper;
        private readonly ScoreHelper _scoreHelper;
        private string mode = "teams";
        public ScoreboardController(
            AppDbContext context,
            CtfTimeHelper ctfTimeHelper,
            ConfigHelper configHelper,
            ScoreHelper scoreHelper)
        {
            _context = context;
            _ctfTimeHelper = ctfTimeHelper;
            _configHelper = configHelper;
            _scoreHelper = scoreHelper;
            mode = _configHelper.UserMode();
        }
        private int? GetAccountId(Solf solve)
        {
            if (mode == "teams")
                return solve.TeamId;
            else if (mode == "users")
                return solve.UserId;
            return null;
        }

        private int? GetAccountId(Award award)
        {
            if (mode == "teams")
                return award.TeamId;
            else if (mode == "users")
                return award.UserId;
            return null;
        }

        [HttpGet("top/{count:int}")]
        public async Task<IActionResult> GetTopTeams(int count, [FromQuery] int? bracket_id)
        {
            var response = new Dictionary<int, object>();
            var standings = await _scoreHelper.GetStandings(count, bracket_id);
            var accountIds = standings.Select(t => t.AccountId).ToList();
            IQueryable<Solf> solvesQuery;
            IQueryable<Award> awardsQuery;
            if (mode == "teams")
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
            var freeze = _configHelper.GetConfig<long?>("freeze");
            if (freeze.HasValue)
            {
                var freezeUtc = DateTimeOffset.FromUnixTimeSeconds(freeze.Value).UtcDateTime;
                solvesQuery = solvesQuery.Where(s => s.IdNavigation.Date < freezeUtc);
                awardsQuery = awardsQuery.Where(a => a.Date < freezeUtc);
            }

            var solves = await solvesQuery
                .Include(s => s.Challenge)
                .Include(s => s.Team)
                .Include(s => s.IdNavigation)
                .ToListAsync();

            var awards = await awardsQuery.ToListAsync();

            var solvesMapper = new Dictionary<int, List<object>>();

            foreach (var solve in solves)
            {
                if (!solvesMapper.ContainsKey(GetAccountId(solve).Value))
                    solvesMapper[GetAccountId(solve).Value] = new List<object>();

                solvesMapper[GetAccountId(solve).Value].Add(new
                {
                    challenge_id = GetAccountId(solve).Value,
                    account_id = solve.TeamId,
                    team_id = solve.TeamId,
                    user_id = solve.UserId,
                    value = solve.Challenge?.Value ?? 0,
                    date = solve?.IdNavigation?.Date
                });
            }

            foreach (var award in awards)
            {
                if (!solvesMapper.ContainsKey(GetAccountId(award).Value))
                    solvesMapper[GetAccountId(award).Value] = new List<object>();

                solvesMapper[GetAccountId(award).Value].Add(new
                {
                    challenge_id = (int?)null,
                    account_id = GetAccountId(award).Value,
                    team_id = award.TeamId,
                    user_id = award.UserId,
                    value = award.Value,
                    date = award.Date
                });
            }

            // Sort theo date
            foreach (var key in solvesMapper.Keys.ToList())
            {
                solvesMapper[key] = solvesMapper[key]
                    .OrderBy(s => (DateTime)s.GetType().GetProperty("date").GetValue(s))
                    .ToList();
            }

            // Build response
            for (int i = 0; i < standings.Count; i++)
            {
                var team = standings[i];
                response[i + 1] = new
                {
                    id = team.AccountId,
                    account_url = "/teams/"+ team.AccountId,
                    name = team.Name,
                    score = (int)team.Score,
                    bracket_id = team.BracketId,
                    bracket_name = team.BracketName,
                    solves = solvesMapper.ContainsKey(team.AccountId.Value) ? solvesMapper[team.AccountId.Value] : new List<object>()
                };
            }

            return Ok(new
            {
                success = true,
                data = response
            });
        }
    }
}

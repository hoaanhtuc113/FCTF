using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using ResourceShared.Utils;
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
        }

        [HttpGet("top/{count:int}")]
        public async Task<IActionResult> GetTopTeams(int count, [FromQuery] int? bracket_id)
        {
            var response = new Dictionary<int, object>();
            var standings = await _scoreHelper.GetStandings(count, bracket_id);
            var teamIds = standings.Select(t => t.AccountId).ToList();

            var solvesQuery = _context.Solves.Where(s => teamIds.Contains(s.TeamId.Value));
            var awardsQuery = _context.Awards.Where(a => teamIds.Contains(a.TeamId.Value));

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
                if (!solvesMapper.ContainsKey(solve.TeamId.Value))
                    solvesMapper[solve.TeamId.Value] = new List<object>();

                solvesMapper[solve.TeamId.Value].Add(new
                {
                    challenge_id = solve.ChallengeId,
                    account_id = solve.TeamId,
                    team_id = solve.TeamId,
                    user_id = solve.UserId,
                    value = solve.Challenge?.Value ?? 0,
                    date = solve?.IdNavigation?.Date
                });
            }

            foreach (var award in awards)
            {
                if (!solvesMapper.ContainsKey(award.TeamId.Value))
                    solvesMapper[award.TeamId.Value] = new List<object>();

                solvesMapper[award.TeamId.Value].Add(new
                {
                    challenge_id = (int?)null,
                    account_id = award.TeamId,
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
                    .OrderBy(s => (string)s.GetType().GetProperty("date").GetValue(s))
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

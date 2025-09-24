using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Submit;
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

        [HttpGet("top2/{count:int}")]
        public async Task<IActionResult> GetTopTeams2(int count, [FromQuery] int? bracket_id)
        {

            var standings = await _scoreHelper.GetStandings2(count, bracket_id);
            var team_ids = standings.Select(t => t.account_id).ToList();

            var model = _configHelper.GetModel();
            List<SolfDTO> solves = new List<SolfDTO>();
            List<AwardsDTO> awards = new List<AwardsDTO>();

            if (model == "users")
            {
                solves = await _context.Solves
                    .Where(s => s.UserId.HasValue && team_ids.Contains(s.UserId.Value))
                    .Select(s => new SolfDTO
                    {
                        Id = s.Id,
                        ChallengeId = s.ChallengeId,
                        AccountId = s.UserId,  
                        Challenge = s.Challenge,
                        IdNavigation = s.IdNavigation,
                        TeamId = s.TeamId,
                        UserId  = s.UserId
                    })
                    .AsNoTracking()
                    .ToListAsync();
            }
            else if(model == "teams")
            {
                solves = await _context.Solves
                    .Where(s => s.TeamId.HasValue && team_ids.Contains(s.TeamId.Value))
                    .Select(s => new SolfDTO
                    {
                        Id = s.Id,
                        ChallengeId = s.ChallengeId,
                        TeamId = s.TeamId,
                        UserId  = s.UserId,
                        AccountId = s.TeamId,   
                        Challenge = s.Challenge,
                        IdNavigation = s.IdNavigation
                    })
                    .AsNoTracking()
                    .ToListAsync();
            }

            if (model == "users")
            {
                awards = await _context.Awards
                    .Where(a => a.UserId.HasValue && team_ids.Contains(a.UserId.Value))
                    .Select(a => new AwardsDTO
                    {
                        Id = a.Id,
                        AccountId = a.UserId,
                        TeamId = a.TeamId,
                        UserId  = a.UserId,
                        Name = a.Name,
                        Description = a.Description,
                        Date = a.Date,
                        Value = a.Value,
                        Category = a.Category,
                        Icon = a.Icon,
                        Requirements = a.Requirements,
                        Type = a.Type
                    })
                    .AsNoTracking()
                    .ToListAsync();
            }
            else if(model == "teams")
            {
                awards = await _context.Awards
                    .Where(a => a.TeamId.HasValue && team_ids.Contains(a.TeamId.Value))
                    .Select(a => new AwardsDTO
                    {
                        Id = a.Id,
                        AccountId = a.TeamId,
                        TeamId = a.TeamId,
                        UserId  = a.UserId,
                        Name = a.Name,
                        Description = a.Description,
                        Date = a.Date,
                        Value = a.Value,
                        Category = a.Category,
                        Icon = a.Icon,
                        Requirements = a.Requirements,
                        Type = a.Type
                    })
                    .AsNoTracking()
                    .ToListAsync();
            }


            var freeze = _configHelper.GetConfig<long?>("freeze");

            if (freeze != null)
            {
                var freeze_utc = DateTimeOffset.FromUnixTimeSeconds(freeze.Value).UtcDateTime;
                solves = solves.Where(s => s.IdNavigation.Date < freeze_utc).ToList();
                awards = awards.Where(a => a.Date < freeze_utc).ToList();
            }

            var solvesMapper = solves
                .GroupBy(s => s.AccountId.Value)
                .ToDictionary(g => g.Key, g => g.Select(solve => new
                {
                    challenge_id = solve.ChallengeId,
                    account_id = solve.AccountId,
                    team_id = solve.TeamId,
                    user_id = solve.UserId,
                    value = solve.Challenge?.Value ?? 0,
                    date = solve?.IdNavigation?.Date
                }).OrderBy(s => s.date).ToList<object>());

           var awardsMapper = awards
                .GroupBy(a => a.TeamId.Value)
                .ToDictionary(g => g.Key, g => g.Select(award => new
                {
                    challenge_id = (int?)null,
                    account_id = award.TeamId,
                    team_id = award.TeamId,
                    user_id = award.UserId,
                    value = award.Value,
                    date = award.Date
                }).OrderBy(a => a.date).ToList<object>());


            var solves_mapper = new Dictionary<int, List<object>>(); 
            solves_mapper.Concat(solvesMapper);
            solves_mapper.Concat(awardsMapper);

            foreach (var key in solvesMapper.Keys.ToList())
            {
                solves_mapper[key] = solves_mapper[key]
                    .OrderBy(s => (string)s.GetType().GetProperty("date").GetValue(s))
                    .ToList();
            }

            var response = new Dictionary<int, object>();
            for (int i = 0; i < standings.Count; i++)
            {
                var team = standings[i];
                response[i + 1] = new
                {
                    id = team.account_id,
                    account_url = "/teams/"+ team.account_id,
                    name = team.name,
                    score = (int)team.score,
                    bracket_id = team.bracket_id,
                    bracket_name = team.bracket_name,
                    solves = solvesMapper.ContainsKey(team.account_id.Value) ? solvesMapper[team.account_id.Value] : new List<object>()
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

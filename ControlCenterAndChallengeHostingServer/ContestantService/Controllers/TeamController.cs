using ContestantService.Extensions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Team;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class TeamController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly CtfTimeHelper _ctfTimeHelper;
        private readonly ConfigHelper _configHelper;
        private readonly ScoreHelper _scoreHelper;
        public TeamController(AppDbContext context, CtfTimeHelper ctfTimeHelper, ConfigHelper configHelper,ScoreHelper scoreHelper)
        {
            _context = context;
            _ctfTimeHelper = ctfTimeHelper;
            _configHelper = configHelper;
            _scoreHelper = scoreHelper;
        }

        [HttpPost("create")]
        public async Task<IActionResult> CreateTeam([FromBody] CreateTeamRequestDTO request)
        {
            if (!_ctfTimeHelper.CtfTime())
            {
                return BadRequest(new
                {
                    success = false,
                    message = "You are not allowed to join a team at this time"
                });
            }

            if (_ctfTimeHelper.CtfEnded())
            {
                return BadRequest(new
                {
                    success = false,
                    message = "You are not allowed to join a team at this time"
                });
            }

            var user = HttpContext.GetCurrentUser();
            if (user == null)
            {
                return BadRequest(new
                {
                    success = false,
                    message = "You must log in first"
                });
            }

            if (!_configHelper.GetConfig("team_creation", true))
            {
                return BadRequest(new
                {
                    success = false,
                    errors = new[] { "Team creation is currently disabled. Please join an existing team." }
                });
            }

            int numberOfTeamsLimit = _configHelper.GetConfig("num_teams", 0);
            int numberOfTeams = _context.Teams.Where(t => t.Banned == false && t.Hidden ==false).Count();
            if (numberOfTeamsLimit > 0 && numberOfTeams >= numberOfTeamsLimit)
            {
                return BadRequest(new
                {
                    success = false,
                    errors = new[] { $"Reached the maximum number of teams ({numberOfTeamsLimit}). Please join an existing team." }
                });
            }

            if (user.TeamId != null)
            {
                return BadRequest(new
                {
                    success = false,
                    errors = new[] { "You are already in a team" }
                });
            }

            var errors = new List<string>();
            string teamName = request.TeamName?.Trim();
            string passphrase = request.TeamPassword?.Trim();
            string website = request.Website;
            string affiliation = request.Affiliation;
            string country = request.Country;
            int? bracketId = request.BracketId;

            // Validate team name
            if (string.IsNullOrWhiteSpace(teamName))
            {
                errors.Add("Team name is required");
            }
            else if (_context.Teams.Any(t => t.Name == teamName))
            {
                errors.Add("That team name is already taken");
            }

            if (!string.IsNullOrEmpty(website) && !Uri.TryCreate(website, UriKind.Absolute, out _))
            {
                errors.Add("Websites must be a proper URL starting with http or https");
            }
            if (!string.IsNullOrEmpty(affiliation) && affiliation.Length >= 128)
            {
                errors.Add("Affiliation must be shorter than 128 characters");
            }

            if (errors.Any())
            {
                return BadRequest(new { success = false, errors });
            }

            bool hidden = user.Type == "admin";

            var team = new Team
            {
                Name = teamName,
                Password = SHA256Helper.HashPasswordPythonStyle(passphrase),
                CaptainId = user.Id,
                Hidden = hidden,
                BracketId = bracketId,
                Website = website,
                Affiliation = affiliation,
                Country = country,
                Created = DateTime.UtcNow
            };

            _context.Teams.Add(team);
            await _context.SaveChangesAsync();

            // Assign team to user
            user.TeamId = team.Id;
            await _context.SaveChangesAsync();

            return Created("", new
            {
                success = true,
                message = "Team created successfully",
                team_id = team.Id
            });
        }

        [HttpGet("contestant")]
        public async Task<IActionResult> GetScoreTeam()
        {
            var user = HttpContext.GetCurrentUser();
            if (user == null)
            {
                return Unauthorized(new
                {
                    success = false,
                    error = "Unauthorized"
                });
            }
            else
            {
                var team = await _context.Teams
                           .Include(t => t.Users)
                           .FirstOrDefaultAsync(t => t.Users.Any(u => u.Id == user.Id));
                if (team == null)
                {
                    return NotFound(new
                    {
                        success = false,
                        error = "Team not found"
                    });
                }
                var users = await _context.Users
                    .Where(u => u.TeamId == team.Id)
                    .ToListAsync();

                var members = new List<object>();

                foreach (var u in users)
                {
                    var score = await _scoreHelper.GetUserScore(u, true);
                    members.Add(new
                    {
                        name = u.Name,
                        email = u.Email,
                        score = score
                    });
                }
                var challenges = await _context.Challenges
                               .Where(c => c.State == "visible")
                               .ToListAsync();
                var totalScore = challenges.Sum(c => c.Value ?? 0);
                var response = new
                {
                    name = team.Name,
                    place = await _scoreHelper.GetTeamPlace(team,true),
                    members,
                    score = await _scoreHelper.GetTeamScore(team,true),
                    challengeTotalScore = totalScore
                };

                return Ok(new
                {
                    success = true,
                    data = response
                });
            }
        }



    }
}

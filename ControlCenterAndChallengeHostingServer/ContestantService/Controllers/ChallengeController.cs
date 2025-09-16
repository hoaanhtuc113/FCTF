using ContestantService.Extensions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using YamlDotNet.Core.Tokens;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ChallengeController : ControllerBase
    {

        private AppDbContext _context;
        private readonly IConnectionMultiplexer _connectionMultiplexer;
        public ChallengeController(AppDbContext context, IConnectionMultiplexer connectionMultiplexer)
        {
            _context = context;
            _connectionMultiplexer = connectionMultiplexer;
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetById(int id)
        {
            // during_ctf_time_only
            try
            {
                RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
                var challenge = await _context.Challenges.Include(c => c.Files)
                                                            .FirstOrDefaultAsync(c => c.Id == id);

                if (challenge == null)
                {
                    return NotFound(new
                    {
                        success = false,
                        message = "Challenge not found"
                    });
                }
                if (challenge.State == "hidden")
                {
                    return NotFound(new
                    {
                        success = false,
                        message = "Challenge now is not available"
                    });
                }

                var user = HttpContext.GetCurrentUser();

                if (user == null)
                {
                    return NotFound(new { error = "User not found" });
                }

                var team = await _context.Teams.FirstOrDefaultAsync(t => t.Id == user.TeamId);

                if (team.Banned == true || user.Banned == true)
                {
                    return NotFound(new { error = "Your team has been banned" });
                }

                var solve_id = await _context.Solves.FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);

                var attempts = await _context.Submissions.CountAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);

                var files = new List<object>();

                foreach (var file in challenge.Files)
                {
                    var token = new
                    {
                        user_id = user.Id,
                        team_id = user.TeamId,
                        file_id = file.Id
                    };

                }

                var challenge_data = new
                {
                    id = challenge.Id,
                    name = challenge.Name,
                    description = ChallengeHelper.ModifyDescription(challenge),
                    max_attempts = challenge.MaxAttempts,
                    attemps = attempts,
                    category = challenge.Category,
                    time_limit = challenge.TimeLimit,
                    require_deploy = challenge.RequireDeploy,
                    type = challenge.Type,
                    next_id = challenge.NextId,
                    solve_by_myteam = solve_id == null ? true : false,
                    files = files,
                    is_captain = user.Id == team.CaptainId,
                };

                var cache_key = ChallengeHelper.GetCacheKey(challenge.Id,team.Id);
                if (await redisHelper.KeyExistsAsync(cache_key))
                {
                    var cached_value = await redisHelper.GetFromCacheAsync<ChallengeCacheDTO>(cache_key);
                    var user_chal = _context.Users.FirstOrDefault(u => u.Id == cached_value.user_id);
                    if(cached_value.challenge_id == challenge.Id)
                    {
                        var time_finished = cached_value.time_finished;
                        var time_remaining = time_finished - (int) DateTimeOffset.Now.ToUnixTimeSeconds();
                        if(time_remaining < 0) time_remaining = 0;

                        return Ok(new
                        {
                            message = $"Challenge was started by: {user_chal.Name}",
                            data = challenge_data,
                            is_started = true,
                            challenge_url = cached_value.challenge_url,
                            time_remaining = time_remaining
                        });
                    }

                    return Ok(new
                    {
                        data = challenge_data,
                        is_started = false
                    });
                }
                return Ok(new
                {
                    success = true,
                    data = challenge_data,
                    is_started = false
                });
            }
            catch (Exception ex)
            {
                return BadRequest(new
                {
                    success = false,
                    message = $"An error occurred {ex.Message}"
                });
            }
        }

        [HttpGet("by-topic")]
        public async Task<IActionResult> GetByTopic()
        {
            var user = HttpContext.GetCurrentUser();

            if (user == null)
            {
                return NotFound(new { error = "Token not found"});
            }

            if (user.Banned == true)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "You have been banned from CTFd",
                    success = false
                });
            }
            try
            {
                var distinct_categories = await _context.Challenges
                    .Where(c => c.State != "hidden")
                    .Select(c => c.Category)
                    .Distinct()
                    .ToListAsync();

                var challenge_counts_by_topic = await _context.Challenges
                    .Where(c => c.State != "hidden")
                    .GroupBy(c => c.Category)
                    .Select(g => new
                    {
                        Category = g.Key,
                        ChallengeCount = g.Count()
                    })
                    .ToListAsync();

                var challenge_count_dict = challenge_counts_by_topic
                    .ToDictionary(x => x.Category!, x => x.ChallengeCount);

                var topics_data = new List<object>();
                foreach (var category in distinct_categories)
                {
                    var topic_name = category;
                    var solved_challenges = _context.Solves.Include(s => s.Challenge)
                                                            .Where(s => s.Challenge.Category == topic_name
                                                                        && s.Challenge.State != "hidden"
                                                                        && s.TeamId == user.TeamId)
                                                            .AsEnumerable()
                                                            .DistinctBy(s => s.ChallengeId)
                                                            .ToList().Count;
                    var challenge_count_by_topic = challenge_count_dict.TryGetValue(topic_name, out int count) ? count : 0;
                    var cleared = false;
                    if (solved_challenges >= challenge_count_by_topic)
                    {
                        cleared = true;
                    }
                    topics_data.Add(new
                    {
                        topic_name = topic_name,
                        challenge_count = challenge_count_by_topic,
                        cleared = cleared
                    });
                }
                return Ok(new
                {
                    success = true,
                    data = topics_data
                });
            } 
            catch(Exception ex)
            {
                return BadRequest(new
                {
                    success = false,
                    message = ex.Message
                });
            }
        }

        [HttpGet("list_challenge/{category_name}")]
        public async Task<IActionResult> ListChallengesByCategoryName([FromRoute] string category_name)
        {
            var user = HttpContext.GetCurrentUser();

            if (user == null)
            {
                return NotFound(new { error = "Token not found" });
            }

            var challenges = await _context.Challenges.Where(c => c.Category == category_name && c.State != "hidden")
                .ToListAsync();

            var topics_data = new List<object>();
            foreach (var challenge in challenges)
            {
                var sovle_id = await _context.Solves.FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);

                topics_data.Add(new {
                    id = challenge.Id,
                    name = challenge.Name,
                    next_id = challenge.NextId,
                    max_attempts = challenge.MaxAttempts,
                    value = challenge.Value,
                    category = challenge.Category,
                    time_limit = challenge.TimeLimit,
                    type = challenge.Type,
                    requirements = challenge.Requirements,
                    solve_by_myteam = sovle_id == null ? true : false,
                });
            }
            return Ok(new
            {
                success = true,
                data = topics_data
            });
        }
    }
}

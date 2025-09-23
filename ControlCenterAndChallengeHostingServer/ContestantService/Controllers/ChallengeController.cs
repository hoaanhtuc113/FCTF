using ContestantService.Attribute;
using ContestantService.Extensions;
using ContestantService.Services;
using ContestantService.Utils;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared;
using ResourceShared.Configs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.File;
using ResourceShared.Models;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using YamlDotNet.Core.Tokens;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ChallengeController : ControllerBase
    {

        private AppDbContext _context;
        private readonly IConnectionMultiplexer _connectionMultiplexer;
        private readonly CtfTimeHelper _ctfTimeHelper;
        private readonly ConfigHelper _configHelper;
        private readonly UserHelper _userHelper;
        private readonly IChallengeServices _challengeServices;
        public ChallengeController(AppDbContext context, CtfTimeHelper ctfTimeHelper ,ConfigHelper configHelper , UserHelper userHelper, 
                            IConnectionMultiplexer connectionMultiplexer, IChallengeServices challengeServices)
        {
            _context = context;
            _connectionMultiplexer = connectionMultiplexer;
            _ctfTimeHelper = ctfTimeHelper;
            _configHelper = configHelper;
            _userHelper = userHelper;
            _challengeServices = challengeServices;
        }

        [HttpGet("{id}")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetById(int id)
        {
            await Console.Out.WriteLineAsync($"start GetById");
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
                    var token = new FileTokenDTOs
                    {
                        user_id = user.Id,
                        team_id = user.TeamId,
                        file_id = file.Id
                    };
                    var file_url = $"/files/{file.Location}?token={ItsDangerousCompatHelper.Dumps(token)}";

                    if (file_url != null) files.Add(file_url);
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
                    solve_by_myteam = solve_id != null ? true : false,
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
                    solve_by_myteam = sovle_id != null ? true : false,
                });
            }
            return Ok(new
            {
                success = true,
                data = topics_data
            });
        }

        #region Attempt Challenge Stop
        //[DuringCtfTimeOnly]
        //[HttpPost("attempt")]
        //public async Task<IActionResult> Attempt([FromBody] ChallengeAttemptRequest request)
        //{
        //    var user = HttpContext.GetCurrentUser();
        //    if (user == null) return NotFound(new { error = "User not found" });

        //    if(request.ChallengeId == 0)  return BadRequest(new { error = "ChallengeId is required" });

        //    var challenge = await _context.Challenges
        //                                    .Include(c => c.Requirements)
        //                                    .FirstOrDefaultAsync(c => c.Id == request.ChallengeId);

        //    if (challenge == null) return NotFound(new { error = "Challenge not found" });

        //    if (_ctfTimeHelper.CtfPaused())
        //    {
        //        return StatusCode(StatusCodes.Status403Forbidden, new
        //        {
        //            success = true,
        //            data =  new {
        //                status = "paused",
        //                message = $"{_configHelper.CtfName().ToString()} is paused"
        //            }
        //        });
        //    }

        //    if (_configHelper.IsUserMode() && user.Team == null)
        //    {
        //       return Forbid();
        //    }

        //    var fails = await _context.Submissions.Where(s => s.ChallengeId == challenge.Id && s.UserId == user.Id && s.Type == "incorrect")
        //                                .CountAsync();

        //    if(challenge.State ==  "hidden") return NotFound();
        //    if(challenge.State ==  "locked") return Forbid();

        //    if (challenge.Requirements != null)
        //    {
        //        var requirements = challenge.Requirements.Split(',').Select(r => r.Trim()).ToList();
        //        var solve_ids = (await _context.Solves
        //                        .Where(s => s.UserId == user.Id)
        //                        .Select(s => s.ChallengeId)
        //                        .OrderBy(id => id)
        //                        .ToListAsync()).ToHashSet();


        //        var all_challenge_ids = (await _context.Challenges
        //                                .AsNoTracking()
        //                                .Select(c => c.Id)
        //                                .ToListAsync()).ToHashSet();
        //        var prereqs = requirements.Where(r => all_challenge_ids.Contains(int.TryParse(r, out var id) ? id : -1)).ToHashSet();

        //        if (!solve_ids.IsSupersetOf((IEnumerable<int?>)prereqs))
        //        {
        //            return Forbid();
        //        }
        //    }


        //    var kpm = await ChallengeHelper.GetWrongSubmissionsPerMinute(_context, user.Id);
        //    var kpm_limit = _configHelper.GetConfig<int>("incorrect_submissions_per_min", 10);
        //    if (kpm >= kpm_limit)
        //    {

        //        if (_ctfTimeHelper.CtfTime())
        //        {
        //            var summit_fail = new Submission
        //            {
        //                UserId = user.Id,
        //                TeamId = user.TeamId,
        //                ChallengeId = challenge.Id,
        //                Ip = _userHelper.GetIP(HttpContext),
        //                Provided = request.Submission,
        //                Type = Enums.SubmissionTypes.INCORRECT,
        //            };

        //            _context.Submissions.Add(summit_fail);
        //            await _context.SaveChangesAsync();
        //        }

        //        await Console.Out.WriteLineAsync($"{DateTime.Now} {user.Name} submitted {request.Submission} on {request.ChallengeId} with kpm {kpm} [TOO FAST]");
        //        return StatusCode(StatusCodes.Status429TooManyRequests, new
        //        {
        //            success = true,
        //            data = new
        //            {
        //                status = "ratelimited",
        //                message = "You're submitting flags too fast. Slow down."
        //            }
        //        });
        //    }

        //    var solve = await _context.Solves.FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.UserId == user.Id);

        //    //Challenge not solved yet
        //    if (solve == null)
        //    {
        //        var max_tries = challenge.MaxAttempts;
        //        if(max_tries.HasValue && max_tries >= 0 && fails >= max_tries)
        //        {
        //            return BadRequest(new
        //            {
        //                success = true,
        //                data = new
        //                {
        //                    status = "incorrect",
        //                    message = "You have 0 tries remaining"
        //                }
        //            });
        //        }

        //        AttemptDTO attempt = await ChallengeHelper.Attempt(_context, challenge, request);

        //        if (attempt.status)
        //        {
        //            if (_ctfTimeHelper.CtfTime())
        //            {
        //                var summit_success = new Submission
        //                {
        //                    UserId = user.Id,
        //                    TeamId = user.TeamId,
        //                    ChallengeId = challenge.Id,
        //                    Ip = _userHelper.GetIP(HttpContext),
        //                    Provided = request.Submission,
        //                    Type = Enums.SubmissionTypes.CORRECT,
        //                };
        //                _context.Submissions.Add(summit_success);
        //                await _context.SaveChangesAsync();

        //                var solf = new Solf
        //                {
        //                    Id = summit_success.Id,
        //                    UserId = user.Id,
        //                    TeamId = user.TeamId,
        //                    ChallengeId = challenge.Id,
        //                };

        //                _context.Solves.Add(solf);
        //                await _context.SaveChangesAsync();

        //                // xóa cache
        //                var cache_key_attempt = ChallengeHelper.GenerateCacheAttemptKey(challenge.Id, user.TeamId.Value);
        //            }
        //            await Console.Out.WriteLineAsync($"{DateTime.Now} {user.Name} submitted {request.Submission} on {request.ChallengeId} with kpm {kpm} [CORRECT]");
        //            var cache_key = ChallengeHelper.GetCacheKey(challenge.Id, user.TeamId.Value);
        //            if (challenge.RequireDeploy)
        //            {

        //            }
        //        }
        //        else
        //        {

        //        }

        //        return Ok();
        //    }
        //    else
        //    {
        //        await Console.Out.WriteLineAsync($"{DateTime.Now} {user.Name} submitted {request.Submission} on {request.ChallengeId} with kpm {kpm} [ALREADY SOLVED]");
        //        return Ok(new
        //        {
        //            success = true,
        //            data = new
        //            {
        //                status = "already_solved",
        //                message = "You or your teammate already solved this"
        //            }
        //        });
        //    }
        //}
        #endregion


        [HttpPost("start")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> StartChallenge([FromBody] ChallengeStartStopReqDTO challengeStartReq)
        {
            var user = HttpContext.GetCurrentUser();
            if (user == null) return NotFound(new { error = "Please login" });
            var challenge = await _context.Challenges.FirstOrDefaultAsync(c => c.Id == challengeStartReq.challenge_id);

            if (challenge == null) return NotFound(new { error = "Challenge not found" });

            var cache_key = ChallengeHelper.GetCacheKey(challenge.Id, user.TeamId.Value);

            if(user.Team == null || user.TeamId == null) return NotFound(new { error = "Team not found" });

            if(!challenge.RequireDeploy) return BadRequest(new { error = "This challenge does not require deploy"});

            if (user.Id != user.Team.CaptainId) return BadRequest(new { error = "Contact the organizers to select a team captain. Only the team captain has the permission to start the challenge." });

            var prepared =  ChallengeHelper.PrepareChallengePayload(challenge, user.TeamId.Value, challenge.TimeLimit ?? -1);
            var endpoint = ContestantServiceConfigHelper.ControlServerAPI + "/api/challenge/start";
            var response =  await _challengeServices.ChallengeStart(prepared.payload, prepared.secretKey, endpoint, cache_key, challenge, user);
            return response.status switch
            {
                HttpStatusCode.OK => Ok(response),
                HttpStatusCode.BadRequest => BadRequest(response),
                HttpStatusCode.NotFound => NotFound(response),
                _ => StatusCode((int)response.status, response)
            };
        }

        [HttpPost("stop-by-user")]
        public async Task<IActionResult> StopChallengeByUser([FromBody] ChallengeStartStopReqDTO challengeStartReq)
        {
            if (challengeStartReq == null || challengeStartReq.challenge_id <= 0)
            {
                return BadRequest(new { error = "ChallengeId is required" });
            }
            var user = HttpContext.GetCurrentUser();
            if (user == null) return NotFound(new { error = "Please login" });
            if (user.TeamId == null || user.Team == null)
            {
                return BadRequest(new { error = "User no join team" });
            }

            var challenge = await _context.Challenges.FirstOrDefaultAsync(c => c.Id == challengeStartReq.challenge_id);

            if (challenge == null) return BadRequest(new { error = "Challenge not found" });
            var cache_key = ChallengeHelper.GetCacheKey(challenge.Id, user.TeamId.Value);

            RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
            if (!await redisHelper.KeyExistsAsync(cache_key))
            {
                return BadRequest(new { error = "Challenge not started or already stopped, no active cache found." });
            }

            try
            {
                await _challengeServices.ForceStopChallenge(cache_key, challenge.Id, user.TeamId.Value);
                return Ok(new
                {
                    isSuccess = true,
                    status = "Stopped",
                    message = "Stop challenge success"
                });
            }
            catch (HttpRequestException e)
            {
                await Console.Out.WriteLineAsync($"Error during stop challenge: {e.Message}");
                return BadRequest(new
                {
                    error = "Failed to connect to stop API",
                    error_detail = e.ToString(),
                }); 
            }
        }
    }
}

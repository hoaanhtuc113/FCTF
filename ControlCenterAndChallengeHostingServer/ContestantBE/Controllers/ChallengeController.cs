using ContestantBE.Attribute;
using ContestantBE.Services;
using ContestantBE.Utils;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared;
using ResourceShared.Attribute;
using ResourceShared.Configs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.DTOs.File;
using ResourceShared.Extensions;
using ResourceShared.Models;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using YamlDotNet.Core.Tokens;

namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [RequireAuth]
    public class ChallengeController : ControllerBase
    {

        private AppDbContext _context;
        private readonly CtfTimeHelper _ctfTimeHelper;
        private readonly ConfigHelper _configHelper;
        private readonly UserHelper _userHelper;
        private readonly IChallengeServices _challengeServices;
        private readonly RedisHelper _redisHelper;
        public ChallengeController(AppDbContext context, CtfTimeHelper ctfTimeHelper ,ConfigHelper configHelper , UserHelper userHelper, 
                             IChallengeServices challengeServices, RedisHelper redisHelper)
        {
            _context = context;
            _ctfTimeHelper = ctfTimeHelper;
            _configHelper = configHelper;
            _userHelper = userHelper;
            _challengeServices = challengeServices;
            _redisHelper = redisHelper;
        }

        [HttpGet("{id}")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetById(int id)
        {
            try
            {
                var user = HttpContext.GetCurrentUser();

                if (user == null)
                {
                    return NotFound(new { error = "User not found" });
                }

                if (user.Team == null || user.Team.Banned == true || user.Banned == true)
                {
                    return NotFound(new { error = "Your team has been banned" });
                }

                var result = await _challengeServices.GetById(id, user);

                if(result.HttpStatusCode != HttpStatusCode.OK || result.Data == null)
                {
                    return StatusCode((int)result.HttpStatusCode, new
                    {
                        success = false,
                        message = result.Message
                    });
                }

                if (result.Data.is_started)
                {
                    return StatusCode((int)result.HttpStatusCode, new
                    {
                        message = result.Message,
                        data = result.Data.challenge,
                        is_started = result.Data.is_started,
                        challenge_url = result.Data.challenge_url,
                        time_remaining = result.Data.time_remaining
                    });
                }

                return StatusCode((int)result.HttpStatusCode, new
                {
                    message = result.Data.success,
                    data = result.Data.challenge,
                    is_started = result.Data.is_started,
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
                var result = await _challengeServices.GetTopic(user);
                return Ok(new
                {
                    success = true,
                    data = result
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

            var challenges = await _challengeServices.GetChallengeByCategories(category_name, user.TeamId);
            return Ok(new
            {
                success = true,
                data = challenges
            });
        }

        [DuringCtfTimeOnly]
        [HttpPost("attempt")]
        public async Task<IActionResult> Attempt([FromBody] ChallengeAttemptRequest request)
        {
           var user = HttpContext.GetCurrentUser();
           if (user == null) return NotFound(new { error = "User not found" });

           if(request.ChallengeId == 0)  return BadRequest(new { error = "ChallengeId is required" });

           var challenge = await _context.Challenges
                                           .FirstOrDefaultAsync(c => c.Id == request.ChallengeId);

           if (challenge == null) return NotFound(new { error = "Challenge not found" });

           if (_configHelper.GetConfig<bool>("paused", false))
           {
               return StatusCode(StatusCodes.Status403Forbidden, new
               {
                   success = true,
                   data =  new {
                       status = "paused",
                       message = $"{_configHelper.CtfName().ToString()} is paused"
                   }
               });
           }

           if (_configHelper.IsUserMode() && user.Team == null)
           {
              return Forbid();
           }

           var team = user.Team;

           // Check captain_only_submit_challenge config
           var captainOnlySubmit = _configHelper.GetConfig<bool>("captain_only_submit_challenge", false);
           if (captainOnlySubmit && team != null && team.CaptainId != user.Id)
           {
               return StatusCode(StatusCodes.Status403Forbidden, new
               {
                   success = false,
                   data = new
                   {
                       status = "forbidden",
                       message = "Only the team captain has permission to submit flags for challenges."
                   }
               });
           }

           // Cooldown check - Check if still in cooldown period
           var cooldownSeconds = challenge.Cooldown ?? 0;
           
           if (cooldownSeconds > 0)
           {
               var cooldownKey = $"submission_cooldown_{challenge.Id}_{user.TeamId.Value}";
            
               
               var lastSubmissionTime = await _redisHelper.GetFromCacheAsync<long?>(cooldownKey);
               
               
               if (lastSubmissionTime.HasValue && lastSubmissionTime.Value > 0)
               {
                   var currentTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                   var timeElapsed = currentTime - lastSubmissionTime.Value;
                   
                  
                   if (timeElapsed < cooldownSeconds)
                   {
                       var remainingCooldown = (int)(cooldownSeconds - timeElapsed);
                       
                       return StatusCode(StatusCodes.Status429TooManyRequests, new
                       {
                           success = true,
                           data = new
                           {
                               status = "ratelimited",
                               message = $"Please wait {remainingCooldown} seconds before submitting again.",
                               cooldown = remainingCooldown
                           }
                       });
                   }

               }             
                // First submission for this challenge+team - set cooldown timestamp
                var newTimestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                await _redisHelper.SetCacheAsync<long>(cooldownKey, newTimestamp, TimeSpan.FromMinutes(10));
               
           }

           var fails = await _context.Submissions.Where(s => s.ChallengeId == challenge.Id && s.UserId == user.Id && s.Type == "incorrect")
                                       .CountAsync();

           if(challenge.State ==  "hidden") return NotFound();
           if(challenge.State ==  "locked") return Forbid();

           // Check prerequisites from Requirements JSON
           if (!string.IsNullOrEmpty(challenge.Requirements))
           {
               try
               {
                   var requirementsObj = System.Text.Json.JsonSerializer.Deserialize<ChallengeRequirementsDTO>(challenge.Requirements);
                   
                   if (requirementsObj?.prerequisites != null && requirementsObj.prerequisites.Count > 0)
                   {
                       var solve_ids = (await _context.Solves
                                       .Where(s => s.UserId == user.Id)
                                       .Select(s => s.ChallengeId)
                                       .OrderBy(id => id)
                                       .ToListAsync()).ToHashSet();

                       var all_challenge_ids = (await _context.Challenges
                                               .AsNoTracking()
                                               .Select(c => c.Id)
                                               .ToListAsync()).ToHashSet();
                       
                       // Convert prereq ids to nullable ints to match solve_ids (IEnumerable<int?>)
                       var prereqs = requirementsObj.prerequisites
                                           .Where(id => all_challenge_ids.Contains(id))
                                           .Select(id => (int?)id)
                                           .ToHashSet();

                       if (!solve_ids.IsSupersetOf(prereqs))
                       {
                           return StatusCode(StatusCodes.Status403Forbidden, new
                           {
                               success = false,
                               message = "You don't have the permission to access this challenge. Complete the required challenges first."
                           });
                       }
                   }
               }
               catch (Exception ex)
               {
                   await Console.Out.WriteLineAsync($"Error parsing requirements for challenge {challenge.Id}: {ex.Message}");
               }
           }


            var kpm = await ChallengeHelper.GetWrongSubmissionsPerMinute(_context, user.Id);
            var kpm_limit = _configHelper.GetConfig<int>("incorrect_submissions_per_min", 10);
            if (kpm >= kpm_limit)
            {

                if (_ctfTimeHelper.CtfTime())
                {
                    var summit_fail = new Submission
                    {
                        UserId = user.Id,
                        TeamId = user.TeamId,
                        ChallengeId = challenge.Id,
                        Ip = _userHelper.GetIP(HttpContext),
                        Provided = request.Submission,
                        Type = Enums.SubmissionTypes.INCORRECT,
                    };

                    _context.Submissions.Add(summit_fail);
                    await _context.SaveChangesAsync();
                }
                return StatusCode(StatusCodes.Status429TooManyRequests, new
                {
                    success = true,
                    data = new
                    {
                        status = "ratelimited",
                        message = "You're submitting flags too fast. Slow down.",
                        cooldown = 0
                    }
                });
            }           
            var solve = await _context.Solves.FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.UserId == user.Id);

            //Challenge not solved yet
            if (solve == null)
            {
                var max_tries = challenge.MaxAttempts;
                // max_attempts = 0 means unlimited, only check if > 0
                if(max_tries.HasValue && max_tries > 0 && fails >= max_tries)
                {
                    return BadRequest(new
                    {
                        success = true,
                        data = new
                        {
                            status = "incorrect",
                            message = "You have 0 tries remaining"
                        }
                    });
                }

                AttemptDTO attempt = await ChallengeHelper.Attempt(_context, challenge, request);

                if (attempt.status)
                {
                    if (_ctfTimeHelper.CtfTime())
                    {
                        var summit_success = new Submission
                        {
                            UserId = user.Id,
                            TeamId = user.TeamId,
                            ChallengeId = challenge.Id,
                            Ip = _userHelper.GetIP(HttpContext),
                            Provided = request.Submission,
                            Type = Enums.SubmissionTypes.CORRECT,
                        };
                        _context.Submissions.Add(summit_success);
                        await _context.SaveChangesAsync();

                        var solf = new Solf
                        {
                            Id = summit_success.Id,
                            UserId = user.Id,
                            TeamId = user.TeamId,
                            ChallengeId = challenge.Id,
                        };

                        _context.Solves.Add(solf);
                        await _context.SaveChangesAsync();
                    }                 
                    var startedKey = ChallengeHelper.GetArgoWName(challenge.Id, user.TeamId.Value);
                   
                    // Auto stop challenge if require_deploy and cache exists
                    if (challenge.RequireDeploy && await _redisHelper.KeyExistsAsync(startedKey))
                    {
                        try
                        {
                            await _challengeServices.ForceStopChallenge(challenge.Id, user);
                        }
                        catch (Exception ex)
                        {
                            await Console.Out.WriteLineAsync($"Error stopping challenge {challenge.Id} for team {user.TeamId}: {ex.Message}");
                        }
                    }

                    return Ok(new
                    {
                        success = true,
                        data = new
                        {
                            status = "correct",
                            message = attempt.message
                        }
                    });
                }
                else
                {
                    if (_ctfTimeHelper.CtfTime())
                    {
                        var summit_fail = new Submission
                        {
                            UserId = user.Id,
                            TeamId = user.TeamId,
                            ChallengeId = challenge.Id,
                            Ip = _userHelper.GetIP(HttpContext),
                            Provided = request.Submission,
                            Type = Enums.SubmissionTypes.INCORRECT,
                        };
                        _context.Submissions.Add(summit_fail);
                        await _context.SaveChangesAsync();
                    }


                    if (max_tries.HasValue && max_tries.Value > 0)
                    {
                        var attemptsLeft = max_tries.Value - fails - 1;
                        var triesStr = attemptsLeft == 1 ? "try" : "tries";
                        var message = attempt.message;
                        if (!string.IsNullOrEmpty(message) && !"!().;?[]{}".Contains(message[^1]))
                        {
                            message += ".";
                        }

                        return Ok(new
                        {
                            success = true,
                            data = new
                            {
                                status = "incorrect",
                                message = $"{message} You have {attemptsLeft} {triesStr} remaining.",
                                cooldown = challenge.Cooldown ?? 0
                            }
                        });
                    }
                    return Ok(new
                    {
                        success = true,
                        data = new
                        {
                            status = "incorrect",
                            message = attempt.message,
                            cooldown = challenge.Cooldown ?? 0
                        }
                    });
                }
            }
            else
            {
                return Ok(new
                {
                    success = true,
                    data = new
                    {
                        status = "already_solved",
                        message = "You or your teammate already solved this"
                    }
                });
            }
        }

        [HttpPost("start")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> StartChallenge([FromBody] ChallengeStartStopReqDTO challengeStartReq)
        {
            var user = HttpContext.GetCurrentUser();
            if (user == null) return NotFound(new { error = "Please login" });
            var challenge = await _context.Challenges.FirstOrDefaultAsync(c => c.Id == challengeStartReq.challengeId);

            if (challenge == null) return NotFound(new { error = "Challenge not found" });

            if(user.Team == null || user.TeamId == null) return NotFound(new { error = "Team not found" });

            if(!challenge.RequireDeploy) return BadRequest(new { error = "This challenge does not require deploy"});

            // Check captain_only_start_challenge config (stored as "1" or "0" in database)
            var captainOnlyStart = _configHelper.GetConfig<bool>("captain_only_start_challenge", true);
            if (captainOnlyStart && user.Id != user.Team.CaptainId)
            {
                return BadRequest(new { error = "Contact the organizers to select a team captain. Only the team captain has the permission to start the challenge." });
            }

            // Check limit_challenges - maximum concurrent challenges per team
            var limit_challenges = _configHelper.LimitChallenges();
            await Console.Out.WriteLineAsync($"[LIMIT CHECK] limit_challenges config: {limit_challenges}, TeamId: {user.TeamId.Value}");
            
            var pods = await _redisHelper.GetFromCacheAsync<List<PodInfo>>(RedisConfigs.PodsInfoKey) ?? new List<PodInfo>();
            await Console.Out.WriteLineAsync($"[LIMIT CHECK] Total pods in cache: {pods?.Count ?? 0}");
            
            var teamPods = pods!.Where(p => p.TeamId == user.TeamId.Value).Count();
            await Console.Out.WriteLineAsync($"[LIMIT CHECK] Team {user.TeamId.Value} has {teamPods} running challenges");
                
            if (teamPods >= limit_challenges)
            {
                return BadRequest(new 
                { 
                    error = $"You have reached the maximum limit of {limit_challenges} concurrent challenges. Please stop a running challenge before starting a new one." 
                });
            }
            pods!.Add(new PodInfo
            {
                Namespace = "N/A",
                TeamId = user.TeamId.Value,
                ChallengeId = challenge.Id,
                Ready = false,
                Status = "Pending",
                Age = "N/A",
                Name = "N/A",
            });
            await _redisHelper.SetCacheAsync(RedisConfigs.PodsInfoKey, pods);


            var response =  await _challengeServices.ChallengeStart(challenge, user);
            return response.status switch
            {
                (int)HttpStatusCode.OK => Ok(response),
                (int)HttpStatusCode.BadRequest => BadRequest(response),
                (int)HttpStatusCode.NotFound => NotFound(response),
                _ => StatusCode((int)response.status, response)
            };
        }

        [HttpPost("stop-by-user")]
        public async Task<IActionResult> StopChallengeByUser([FromBody] ChallengeStartStopReqDTO challengeStartReq)
        {
            if (challengeStartReq == null || challengeStartReq.challengeId <= 0)
            {
                return BadRequest(new { error = "ChallengeId is required" });
            }
            var user = HttpContext.GetCurrentUser();
            if (user == null) return NotFound(new { error = "Please login" });
            if (user.TeamId == null || user.Team == null)
            {
                return BadRequest(new { error = "User no join team" });
            }

            var challenge = await _context.Challenges.FirstOrDefaultAsync(c => c.Id == challengeStartReq.challengeId);

            if (challenge == null) return BadRequest(new { error = "Challenge not found" });
            var cache_key = ChallengeHelper.GetCacheKey(challenge.Id, user.TeamId.Value);

            if (!await _redisHelper.KeyExistsAsync(cache_key))
            {
                return BadRequest(new { error = "Challenge not started or already stopped, no active cache found." });
            }

            try
            {
                var response = await _challengeServices.ForceStopChallenge(challenge.Id, user);
                return response.status switch
                {
                    (int)HttpStatusCode.OK => Ok(response),
                    (int)HttpStatusCode.BadRequest => BadRequest(response),
                    (int)HttpStatusCode.NotFound => NotFound(response),
                    _ => StatusCode((int)response.status, response)
                };
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

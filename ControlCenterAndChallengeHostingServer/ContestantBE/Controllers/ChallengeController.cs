using ContestantBE.Attribute;
using ContestantBE.Services;
using ContestantBE.Utils;
using k8s.KubeConfigModels;
using Microsoft.AspNetCore.Authorization;
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
using System.Security.Claims;
using YamlDotNet.Core.Tokens;
using static ResourceShared.Enums;

namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class ChallengeController : ControllerBase
    {

        private AppDbContext _context;
        private readonly CtfTimeHelper _ctfTimeHelper;
        private readonly ConfigHelper _configHelper;
        private readonly UserHelper _userHelper;
        private readonly IChallengeServices _challengeServices;
        private readonly RedisHelper _redisHelper;

        // Helper method: Increment and check KPM using Redis atomic INCR
        private async Task<(bool exceeded, int current)> CheckAndIncrementKpmAsync(int userId, int limit)
        {
            if (limit <= 0) return (false, 0);
            
            var kpmKey = $"kpm_check_{userId}";
            var currentMinute = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 60;
            var kpmWithMinuteKey = $"{kpmKey}_{currentMinute}";
            
            // Use Redis INCR - atomic operation (thread-safe)
            var redis = await _redisHelper.GetDatabaseAsync();
            var newCount = await redis.StringIncrementAsync(kpmWithMinuteKey);
            
            // Always set TTL to ensure key expires at end of current minute + 1 minute buffer
            // This prevents keys from persisting indefinitely if TTL fails on first increment
            var ttl = await redis.KeyTimeToLiveAsync(kpmWithMinuteKey);
            if (!ttl.HasValue || ttl.Value.TotalSeconds < 0)
            {
                // Key has no TTL or already expired, set it for 90 seconds (current minute + 30s buffer)
                await redis.KeyExpireAsync(kpmWithMinuteKey, TimeSpan.FromSeconds(90));
            }
            
            // Check if exceeded limit
            if (newCount > limit)
            {
                return (true, (int)newCount);
            }
            
            return (false, (int)newCount);
        }

        public ChallengeController(AppDbContext context, CtfTimeHelper ctfTimeHelper, ConfigHelper configHelper, UserHelper userHelper,
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
                var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
                var user = await _context.Users
                                        .Include(u => u.Team)
                                        .FirstOrDefaultAsync(u => u.Id.ToString() == userId);

                if (user == null)
                {
                    return NotFound(new { error = "User not found" });
                }

                if (user.Team == null || user.Team.Banned == true || user.Banned == true)
                {
                    return NotFound(new { error = "Your team has been banned" });
                }

                var result = await _challengeServices.GetById(id, user);

                if (result.HttpStatusCode != HttpStatusCode.OK || result.Data == null)
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
            var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = await _context.Users
                                        .Include(u => u.Team)
                                        .FirstOrDefaultAsync(u => u.Id.ToString() == userId);
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
            var teamId =  int.Parse(User.FindFirstValue("teamId"));
            //Console.WriteLine($"[ListChallengesByCategoryName] teamId: {teamId}, category_name: {category_name}");

            var challenges = await _challengeServices.GetChallengeByCategories(category_name, teamId);
            return Ok(new
            {
                success = true,
                data = challenges
            });
        }

        [HttpGet("instances")]
        public async Task<IActionResult> GetAllInstances()
        {
            try
            {
                var teamId = int.Parse(User.FindFirstValue("teamId"));
                var instances = await _challengeServices.GetAllInstances(teamId);
                return Ok(new
                {
                    success = true,
                    data = instances
                });
            }
            catch (Exception ex)
            {
                return BadRequest(new
                {
                    success = false,
                    message = ex.Message
                });
            }
        }

        [DuringCtfTimeOnly]
        [HttpPost("attempt")]
        public async Task<IActionResult> Attempt([FromBody] ChallengeAttemptRequest request)
        {
            var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = await _context.Users
                                         .Include(u => u.Team)
                                         .FirstOrDefaultAsync(u => u.Id.ToString() == userId);

            if (request.ChallengeId == 0) return BadRequest(new { error = "ChallengeId is required" });

            var challenge = await _context.Challenges
                                            .FirstOrDefaultAsync(c => c.Id == request.ChallengeId);

            if (challenge == null) return NotFound(new { error = "Challenge not found" });

            await Console.Out.WriteLineAsync($"[Requesst Attempt Challenge] User {userId} : Team {user.TeamId} : Challenge {challenge.Name} with flag {request.Submission}");

            if (_configHelper.GetConfig<bool>("paused", false))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    success = true,
                    data = new
                    {
                        status = "paused",
                        message = $"{_configHelper.CtfName().ToString()} is paused"
                    }
                });
            }

           if (_configHelper.IsUserMode() && user.Team == null)
           {
              return Forbid();
           }
           request.Submission = request.Submission?.Trim();
           
           // Validate submission length (max 1000 characters)
           if (string.IsNullOrEmpty(request.Submission))
           {
               return BadRequest(new
               {
                   success = false,
                   data = new
                   {
                       status = "invalid",
                       message = "Submission cannot be empty"
                   }
               });
           }
           
           if (request.Submission.Length > 1000)
           {
               return BadRequest(new
               {
                   success = false,
                   data = new
                   {
                       status = "invalid",
                       message = "Submission exceeds maximum length of 1000 characters"
                   }
               });
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


            if (challenge.State ==  "hidden") return NotFound();
            if (challenge.State ==  "locked") return Forbid();

            // Check prerequisites from Requirements JSON
            if (!string.IsNullOrEmpty(challenge.Requirements))
            {
                try
                {
                    var requirementsObj = System.Text.Json.JsonSerializer.Deserialize<ChallengeRequirementsDTO>(challenge.Requirements);

                    if (requirementsObj?.prerequisites != null && requirementsObj.prerequisites.Count > 0)
                    {
                        var solve_ids = (await _context.Solves
                                        .Where(s => s.TeamId == user.TeamId)
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
                    await Console.Error.WriteLineAsync($"Error parsing requirements for challenge {challenge.Id}: {ex.Message}");
                }
            }



            // Pre-check 1: Already solved (no lock - read-only, common case)
            var solvePreCheck = await _context.Solves.AsNoTracking().FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);
            if (solvePreCheck != null)
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

            // Pre-check 2: Max attempts exceeded (no lock - optimistic check)
            int? currentFailsPreCheck = null;
            if (challenge.MaxAttempts.HasValue && challenge.MaxAttempts.Value > 0)
            {
                currentFailsPreCheck = await _context.Submissions
                    .AsNoTracking()
                    .Where(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId && s.Type == "incorrect")
                    .CountAsync();

                if (currentFailsPreCheck >= challenge.MaxAttempts.Value)
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
            }

            // Attempt the challenge (outside lock - CPU intensive, parallel execution OK)
            AttemptDTO attempt = await ChallengeHelper.Attempt(_context, challenge, request);
            var deploymentKey = ChallengeHelper.GetCacheKey(challenge.Id, user.TeamId.Value);

            // Handle correct attempt - CRITICAL SECTION with minimal lock
            if (attempt.status)
            {
                if (_ctfTimeHelper.CtfTime())
                {
                    // Re-validate inside lock (race condition protection)
                    var solveCheck = await _context.Solves.FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);
                    if (solveCheck != null)
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
                    try
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
                        try
                        {
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
                        catch (Exception solfEx)
                        {
                            _context.Submissions.Remove(summit_success);
                            await _context.SaveChangesAsync();

                            return StatusCode(StatusCodes.Status500InternalServerError, new
                            {
                                success = false,
                                error = "Failed to record solve. Please try again."
                            });
                        }
                    }
                    catch (Exception ex)
                    {
                        await Console.Error.WriteLineAsync($"[Error] Submission save failed for challenge {challenge.Id}, team {user.TeamId}: {ex.Message}");
                        return StatusCode(StatusCodes.Status500InternalServerError, new
                        {
                            success = false,
                            error = "Failed to record submission. Please try again."
                        });
                    }
                    // Handle dynamic challenge value calculation
                    if (challenge.Type == "dynamic")
                    {
                        await DynamicChallengeHelper.RecalculateDynamicChallengeValue(_context, challenge.Id);
                    }

                }

                // Auto stop challenge if require_deploy and cache exists
                if (challenge.RequireDeploy && await _redisHelper.KeyExistsAsync(deploymentKey))
                {
                    try
                    {
                        await _challengeServices.ForceStopChallenge(challenge.Id, user);
                    }
                    catch (Exception ex)
                    {
                        await Console.Error.WriteLineAsync($"Error stopping challenge {challenge.Id} for team {user.TeamId}: {ex.Message}");
                    }
                }

                return Ok(new
                {
                    success = true,
                    data = new
                    {
                        status = "correct",
                        message = attempt.message,
                        value = challenge.Value
                    }
                });
            }

            // Handle incorrect attempt with rate limit + max attempts validation
            if (_ctfTimeHelper.CtfTime())
            {
                var kpm_limit = _configHelper.GetConfig<int>("incorrect_submissions_per_min", 10);

                // Phase 1: Check KPM with Redis (lightweight, no DB query)
                var (kpmExceeded, kpmCount) = await CheckAndIncrementKpmAsync(user.Id, kpm_limit);
                if (kpmExceeded)
                {
                    return StatusCode(StatusCodes.Status429TooManyRequests, new
                    {
                        success = true,
                        data = new
                        {
                            status = "ratelimited",
                            message = $"You're submitting flags too fast. Slow down. ({kpmCount}/{kpm_limit} attempts in last minute)",
                            cooldown = 0
                        }
                    });
                }

                var hasMaxAttempts = challenge.MaxAttempts.HasValue && challenge.MaxAttempts.Value > 0;

                // Phase 2: Max attempts validation using Redis Lua script (atomic operation)
                if (hasMaxAttempts)
                {
                    var attemptKey = $"attempt_count_{challenge.Id}_{user.TeamId}";

                    // Calculate smart sync threshold (1.5x maxAttempts)
                    var smartSyncThreshold = (long)(challenge.MaxAttempts.Value * 1.5);

                    // Get actual DB count for smart sync (only used if counter is corrupted)
                    var actualDbCount = await _context.Submissions
                        .AsNoTracking()
                        .Where(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId && s.Type == "incorrect")
                        .CountAsync();

                    // Execute Lua script: atomic smart sync + pre-check + INCR + double-check
                    // Returns -1 if exceeded, otherwise returns new count
                    var result = await _redisHelper.CheckAndIncrementAttemptsAsync(
                        attemptKey,
                        challenge.MaxAttempts.Value,
                        smartSyncThreshold,
                        actualDbCount
                    );

                    if (result == -1)
                    {
                        // Exceeded limit - reject without DB insert
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

                    // Within limit - update cached count for response message
                    currentFailsPreCheck = (int)result;
                }

                // Save incorrect submission to DB (only if within limit)
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

            var max_tries_check = challenge.MaxAttempts;
            if (!max_tries_check.HasValue || max_tries_check.Value <= 0)
            {
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

            // Calculate remaining attempts (use cached count if available)
            var failsCount = currentFailsPreCheck ?? await _context.Submissions
                .Where(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId && s.Type == "incorrect")
                .CountAsync();
            var attemptsLeft = max_tries_check.Value - failsCount;
            var triesStr = attemptsLeft == 1 ? "try" : "tries";
            var message = attempt.message;

            if (!string.IsNullOrEmpty(message) && !"!().;?[]{}".Contains(message[^1]))
            {
                message += ".";
            }

            // Auto stop challenge if no attempts left
            if (attemptsLeft <= 0 && challenge.RequireDeploy && await _redisHelper.KeyExistsAsync(deploymentKey))
            {
                try
                {
                    await _challengeServices.ForceStopChallenge(challenge.Id, user);
                }
                catch (Exception ex)
                {
                    await Console.Error.WriteLineAsync($"Error stopping challenge {challenge.Id} for team {user.TeamId}: {ex.Message}");
                }
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


        [HttpPost("start")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> StartChallenge([FromBody] ChallengeStartStopReqDTO challengeStartReq)
        {
            
            var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = await _context.Users
                                         .Include(u => u.Team)
                                         .FirstOrDefaultAsync(u => u.Id.ToString() == userId);
            if (user.Team == null || user.TeamId == null) return NotFound(new { error = "Team not found" });

            var challenge = await _context.Challenges.FirstOrDefaultAsync(c => c.Id == challengeStartReq.challengeId);

            if (challenge == null) return NotFound(new { error = "Challenge not found" });
            if (!challenge.RequireDeploy) return BadRequest(new { error = "This challenge does not require deploy" });
            if (challenge.State == ChallengeState.HIDDEN) return BadRequest(new { error = "This challenge is not available for deployment" });


            // Check prerequisites from Requirements JSON
            if (!string.IsNullOrEmpty(challenge.Requirements))
            {
                try
                {
                    var requirementsObj = System.Text.Json.JsonSerializer.Deserialize<ChallengeRequirementsDTO>(challenge.Requirements);

                    if (requirementsObj?.prerequisites != null && requirementsObj.prerequisites.Count > 0)
                    {
                        var solve_ids = (await _context.Solves
                                        .Where(s => s.TeamId == user.TeamId)
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
                                error = "You don't have the permission to start this challenge. Please complete the required challenges first."
                            });
                        }
                    }
                }
                catch (Exception ex)
                {
                    await Console.Error.WriteLineAsync($"Error parsing requirements for challenge {challenge.Id}: {ex.Message}");
                }
            }

            var submission = await _context.Submissions.Where(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId).AsNoTracking().ToArrayAsync();
            if (challenge.MaxAttempts > 0 && submission.Count() >= challenge.MaxAttempts)
            {
                return BadRequest(new { error = "Your team has reached the maximum number of attempts for this challenge. You cannot start this challenge." });
            }

            var solve = await _context.Solves.FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);
            if (solve != null)
            {
                return BadRequest(new { error = "Your team has already solved this challenge. You cannot start this challenge." });
            }

            // Check captain_only_start_challenge config (stored as "1" or "0" in database)
            var captainOnlyStart = _configHelper.GetConfig<bool>("captain_only_start_challenge", true);
            if (captainOnlyStart && user.Id != user.Team.CaptainId)
            {
                return BadRequest(new { error = "Contact the organizers to select a team captain. Only the team captain has the permission to start the challenge." });
            }

            await Console.Out.WriteLineAsync($"[Requesst Start Challenge] User {userId} : Team {user.TeamId} : Challenge {challenge.Name}");

            // Check limit_challenges - maximum concurrent challenges per team
            var limit_challenges = _configHelper.LimitChallenges();

            var deploymentKey = ChallengeHelper.GetCacheKey(challengeStartReq.challengeId, user.TeamId.Value);
            var teamIdStr = user.TeamId.Value.ToString();
            var challengeIdStr = challenge.Id.ToString();
            var cacheDto = new ChallengeDeploymentCacheDTO
            {
                challenge_id = challenge.Id,
                team_id = user.TeamId.Value,
                status = DeploymentStatus.INITIAL,
                user_id = user.Id,
            };
            string deploymentValue = System.Text.Json.JsonSerializer.Serialize(cacheDto);

            DeploymentCheckResult redisResult = await _redisHelper.AtomicCheckAndCreateDeploymentZSet(
                                teamId: teamIdStr,
                                deploymentKey: deploymentKey,
                                challengeId: challengeIdStr,
                                maxLimit: limit_challenges,
                                deploymentValue: deploymentValue,
                                provisioningTtl: 300
                            );

            switch (redisResult)
            {
                case DeploymentCheckResult.LimitExceeded:
                    await Console.Out.WriteLineAsync($" Team {user.TeamId} had limit exceeded from challenge {challenge.Name}");
                    return BadRequest(new { error = $"You have reached the maximum limit of {limit_challenges} concurrent challenges." });
                case DeploymentCheckResult.AlreadyExists:
                    await Console.Out.WriteLineAsync($" Team {user.TeamId} had already deploy from challenge {challenge.Name}");
                    var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey) ?? new ChallengeDeploymentCacheDTO();

                    switch (deploymentCache.status)
                    {
                        case DeploymentStatus.INITIAL:
                            return BadRequest(new { error = "Your previous challenge deployment is still in progress. Please wait until it is completed before starting a new one." });
                        case DeploymentStatus.PENDING:
                            return Ok(new ChallengeDeployResponeDTO
                            {
                                status = (int)HttpStatusCode.OK,
                                success = true,
                                message = "Challenge is deploying.",
                            });
                        case DeploymentStatus.RUNING:
                            int timeLeft = 0;
                            if (deploymentCache.time_finished > 0)
                            {
                                long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

                                long remainSec = deploymentCache.time_finished - now;
                                if (remainSec < 0) remainSec = 0;

                                timeLeft = (int)(remainSec / 60);
                            }
                            return Ok(new ChallengeDeployResponeDTO
                            {
                                status = (int)HttpStatusCode.OK,
                                success = true,
                                message = "Challenge is running.",
                                challenge_url = deploymentCache.challenge_url,
                                time_limit = timeLeft,
                            });
                        default:
                            return BadRequest(new { error = "You have already started this challenge." });
                    }
                case DeploymentCheckResult.Pass:
                    break;
                default:
                    return StatusCode(500, new { error = "Unexpected Redis error." });
            }

            try
            {
                var response = await _challengeServices.ChallengeStart(challenge, user);
                if (response.status != (int)HttpStatusCode.OK)
                {
                    // >>> ROLLBACK: Xóa ngay slot vừa chiếm trong Redis <<<
                    await Console.Error.WriteLineAsync($"[Rollback] Team {user.TeamId} start challenge failed: {response.message}.");
                    await _redisHelper.AtomicRemoveDeploymentZSet(teamIdStr, deploymentKey, challengeIdStr);
                }
                return response.status switch
                {
                    (int)HttpStatusCode.OK => Ok(response),
                    (int)HttpStatusCode.BadRequest => BadRequest(response),
                    (int)HttpStatusCode.NotFound => NotFound(response),
                    _ => StatusCode((int)response.status, response)
                };
            }
            catch (Exception e)
            {
                await Console.Error.WriteLineAsync($"[Rollback] Exception during start challenge: {e.Message}. Reverting Redis for {deploymentKey}");
                await _redisHelper.AtomicRemoveDeploymentZSet(teamIdStr, deploymentKey, challengeIdStr);
                return BadRequest(new
                {
                    error = "Failed to connect to start API",
                    error_detail = e.ToString(),
                });
            }
        }

        [HttpPost("stop-by-user")]
        public async Task<IActionResult> StopChallengeByUser([FromBody] ChallengeStartStopReqDTO challengeStartReq)
        {
            if (challengeStartReq == null || challengeStartReq.challengeId <= 0)
            {
                return BadRequest(new { error = "ChallengeId is required" });
            }
            var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = await _context.Users
                                         .Include(u => u.Team)
                                         .FirstOrDefaultAsync(u => u.Id.ToString() == userId);
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
                await Console.Out.WriteLineAsync($"[Requesst Stop Challenge] User {userId} : Team {user.TeamId} : Challenge {challenge.Name}");

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
                await Console.Error.WriteLineAsync($"Error during stop challenge: {e.Message}");
                return BadRequest(new
                {
                    error = "Failed to connect to stop API",
                    error_detail = e.ToString(),
                });
            }
        }

        [HttpPost("check-status")]
        public async Task<IActionResult> CheckChallengeStatus([FromBody] ChallengCheckStatusReqDTO statusReq)
        {
            if (statusReq == null || statusReq.challengeId <= 0)
            {
                return BadRequest(new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Invalid request parameters",
                    status = (int)HttpStatusCode.BadRequest
                });
            }
            var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = await _context.Users
                                         .Include(u => u.Team)
                                         .FirstOrDefaultAsync(u => u.Id.ToString() == userId);
            if (user.TeamId == null || user.Team == null)
            {
                return BadRequest(new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "User no join team",
                    status = (int)HttpStatusCode.BadRequest
                });
            }

            var challenge = await _context.Challenges.FirstOrDefaultAsync(c => c.Id == statusReq.challengeId);

            if (challenge == null) return BadRequest(new ChallengeDeployResponeDTO
            {
                success = false,
                message = "Challenge not found",
                status = (int)HttpStatusCode.BadRequest
            });

            var response = await _challengeServices.CheckChallengeStart(challenge.Id, user.TeamId.Value);
            return response.status switch
            {
                (int)HttpStatusCode.OK => Ok(response),
                (int)HttpStatusCode.BadRequest => BadRequest(response),
                (int)HttpStatusCode.NotFound => NotFound(response),
                _ => StatusCode((int)response.status, response)
            };
        }
    }
}

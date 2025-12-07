using ContestantBE.Utils;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using ResourceShared;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.DTOs.File;
using ResourceShared.DTOs.Topic;
using ResourceShared.Models;
using ResourceShared.ResponseViews;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Net;
using System.Reflection.PortableExecutable;
using System.Text.Json;
using static ResourceShared.Enums;

namespace ContestantBE.Services
{
    public interface IChallengeServices
    {
        Task<ChallengeDeployResponeDTO> ChallengeStart(Challenge challenge, User user);
        Task<ChallengeDeployResponeDTO> ForceStopChallenge(int challengeId, User user);
        Task<ChallengeDeployResponeDTO> CheckChallengeStatus(int challengeId, int teamId);
        Task<ChallengeDeployResponeDTO> CheckChallengeStart(int challengeId, int teamId);
        Task<BaseResponseDTO<ChallengeByIdDTO>> GetById(int challengeId, User user);
        Task<List<TopicDTO>> GetTopic(User user);
        Task<List<ChallengeByCategoryDTO>> GetChallengeByCategories(string cacategory_name, int? team_id);
        Task<List<ChallengeInstanceDTO>> GetAllInstances(int teamId);
    }

    public class ChallengeServices : IChallengeServices
    {
        private readonly IHttpClientFactory _httpFactory;
        private readonly AppDbContext _dbContext;
        private readonly RedisHelper _redisHelper;
        private readonly ConfigHelper _configHelper;
        public static int port = 30000;
        public ChallengeServices(IHttpClientFactory httpFactory, AppDbContext dbContext, RedisHelper redisHelper, ConfigHelper configHelper)
        {
            _httpFactory = httpFactory;
            _dbContext=dbContext;
            _redisHelper=redisHelper;
            _configHelper=configHelper;
        }
        public async Task<BaseResponseDTO<ChallengeByIdDTO>> GetById(int challengeId, User user)
        {
            var challenge = await _dbContext.Challenges.Include(c => c.Files)
                                                        .FirstOrDefaultAsync(c => c.Id == challengeId);

            if (challenge == null)
            {
                return new BaseResponseDTO<ChallengeByIdDTO>
                {
                    HttpStatusCode = HttpStatusCode.NotFound,
                    Message = "Challenge not found"
                };
            }
            if (challenge.State == "hidden")
            {
                return new BaseResponseDTO<ChallengeByIdDTO>
                {
                    HttpStatusCode = HttpStatusCode.NotFound,
                    Message = "Challenge now is not available"
                };
            }

            var solve_id = await _dbContext.Solves.FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);

            var attempts = await _dbContext.Submissions.CountAsync(s => s.ChallengeId == challenge.Id && s.TeamId == user.TeamId);

            var files = new List<object>();
            foreach (var file in challenge.Files)
            {
                var token = new FileTokenDTOs
                {
                    user_id = user.Id,
                    team_id = user.TeamId,
                    file_id = file.Id
                };
                var file_url = $"/files?path={file.Location}&token={ItsDangerousCompatHelper.Dumps(token)}";

                if (file_url != null) files.Add(file_url);
            }
            var captainOnlyStart = _configHelper.GetConfig<bool>("captain_only_start_challenge", true);
            var captainOnlySubmit = _configHelper.GetConfig<bool>("captain_only_submit_challenge", true);
            var challenge_data = new ChallengeDataDto
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
                is_captain = user.Id == user.Team.CaptainId,
                captain_only_start = captainOnlyStart,
                captain_only_submit = captainOnlySubmit,
            };

            var cache_key = ChallengeHelper.GetCacheKey(challenge.Id, user.Team.Id);
            if (await _redisHelper.KeyExistsAsync(cache_key))
            {
                var cached_value = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(cache_key);
                if (cached_value == null)
                {
                    return new BaseResponseDTO<ChallengeByIdDTO>
                    {
                        HttpStatusCode = HttpStatusCode.OK,
                        Data = new ChallengeByIdDTO
                        {
                            challenge = challenge_data,
                            is_started = false
                        }
                    };
                }

                var user_chal =  await _dbContext.Users.FirstOrDefaultAsync(u => u.Id == cached_value.user_id);
                if (cached_value.challenge_id == challenge.Id)
                {
                    var time_finished = cached_value.time_finished;
                    var time_remaining = time_finished - DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                    if (time_remaining < 0) time_remaining = 0;


                    return new BaseResponseDTO<ChallengeByIdDTO>
                    {
                        HttpStatusCode = HttpStatusCode.OK,
                        Message = $"Challenge was started by: {user_chal.Name}",
                        Data = new ChallengeByIdDTO
                        {
                            challenge = challenge_data,
                            is_started = true,
                            challenge_url = cached_value.challenge_url,
                            time_remaining = time_remaining
                        }
                    };
                }


            }
            return new BaseResponseDTO<ChallengeByIdDTO>
            {
                HttpStatusCode = HttpStatusCode.OK,
                Data = new ChallengeByIdDTO
                {
                    success = true,
                    challenge = challenge_data,
                    is_started = false
                }
            };
        }

        public async Task<List<ChallengeByCategoryDTO>> GetChallengeByCategories(string category_name, int? team_id)
        {
            var challenges = await _dbContext.Challenges.Where(c => c.Category == category_name && c.State != Enums.ChallengeState.HIDDEN)
                .ToListAsync();

            var topics_data = new List<ChallengeByCategoryDTO>();
            foreach (var challenge in challenges)
            {
                var sovle_id = await _dbContext.Solves.FirstOrDefaultAsync(s => s.ChallengeId == challenge.Id && s.TeamId == team_id);

                // Parse requirements JSON string
                ChallengeRequirementsDTO? requirementsObj = null;
                if (!string.IsNullOrEmpty(challenge.Requirements))
                {
                    try
                    {
                        requirementsObj = JsonConvert.DeserializeObject<ChallengeRequirementsDTO>(challenge.Requirements);
                    }
                    catch (Exception ex)
                    {
                        await Console.Error.WriteLineAsync($"Error parsing requirements for challenge {challenge.Id}: {ex.Message}");
                    }
                }

                var deploymentCacheKey = ChallengeHelper.GetCacheKey(challenge.Id, team_id.Value);
                var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentCacheKey);
                // Check pod status if challenge requires deployment
                string? podStatus = null;
                if (challenge.RequireDeploy == true && deploymentCache != null)
                {
                    podStatus = deploymentCache.status;
                }

                topics_data.Add(new ChallengeByCategoryDTO
                {
                    id = challenge.Id,
                    name = challenge.Name,
                    next_id = challenge.NextId,
                    max_attempts = challenge.MaxAttempts,
                    value = challenge.Value,
                    category = challenge.Category,
                    time_limit = challenge.TimeLimit,
                    type = challenge.Type,
                    requirements = requirementsObj,
                    solve_by_myteam = sovle_id != null ? true : false,
                    pod_status = podStatus,
                });
            }

            return topics_data;
        }

        public async Task<List<TopicDTO>> GetTopic(User user)
        {
            var distinct_categories = await _dbContext.Challenges
                    .Where(c => c.State != Enums.ChallengeState.HIDDEN)
                    .Select(c => c.Category)
                    .Distinct()
                    .ToListAsync();

            var challenge_counts_by_topic = await _dbContext.Challenges
                .Where(c => c.State != Enums.ChallengeState.HIDDEN)
                .GroupBy(c => c.Category)
                .Select(g => new
                {
                    Category = g.Key,
                    ChallengeCount = g.Count()
                })
                .ToListAsync();

            var challenge_count_dict = challenge_counts_by_topic
                .ToDictionary(x => x.Category!, x => x.ChallengeCount);

            var topics_data = new List<TopicDTO>();
            foreach (var category in distinct_categories)
            {
                var topic_name = category;
                var solved_challenges = _dbContext.Solves.Include(s => s.Challenge)
                                                        .Where(s => s.Challenge.Category == topic_name
                                                                    && s.Challenge.State != Enums.ChallengeState.HIDDEN
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
                topics_data.Add(new TopicDTO
                {
                    topic_name = topic_name,
                    challenge_count = challenge_count_by_topic,
                    cleared = cleared
                });
            }

            return topics_data;
        }

        public async Task<ChallengeDeployResponeDTO> ChallengeStart(Challenge challenge, User user)
        {
            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            };
            try
            {
                var unixTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                var parammeters = new ChallengeStartStopReqDTO
                {
                    challengeId = challenge.Id,
                    teamId = user.TeamId.Value,
                    userId = user.Id,
                    unixTime = unixTime.ToString()
                };
                var data = new Dictionary<string, string>
                {
                    { "challengeId", challenge.Id.ToString() },
                    { "teamId", user.TeamId.Value.ToString() },
                    { "userId", user.Id.ToString() },
                };
                string generatedSecretKey = SecretKeyHelper.CreateSecretKey(unixTime, data);

                var headers = new Dictionary<string, string>
                {
                    { "SecretKey", generatedSecretKey }
                };
                MultiServiceConnector multiServiceConnector = new MultiServiceConnector(ContestantBEConfigHelper.DeploymentCenterAPI);
                var body = await multiServiceConnector.ExecuteRequest("/api/challenge/start", Method.Post, parammeters, headers);
                if (body == null)
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.BadRequest,
                        success = false,
                        message = "No response from server"
                    };

                var result = JsonConvert.DeserializeObject<ChallengeDeployResponeDTO>(body);
                if (result == null)
                {
                    await Console.Out.WriteLineAsync("Failed to deserialize response");
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.InternalServerError,
                        success = false,
                        message = "Failed to parse server response"
                    };
                }
                return result;

            }
            catch (HttpRequestException ex)
            {
                await Console.Error.WriteLineAsync($"Error connecting to API: {ex.Message}");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.BadGateway,
                    success = false,
                    message = "Connection url failed"
                };
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"Unexpected error: {ex.Message}");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Unexpected error occurred"
                };
            }
        }

        public async Task<ChallengeDeployResponeDTO> ForceStopChallenge(int challengeId, User user)
        {
            var unixTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var data = new Dictionary<string, string>
            {
                { "challengeId", challengeId.ToString() },
                { "teamId", user.TeamId.ToString()},
            };
            var parammeters = new ChallengeStartStopReqDTO
            {
                challengeId = challengeId,
                teamId = user.TeamId.Value,
                unixTime = unixTime.ToString()
            };
            var secretKey = SecretKeyHelper.CreateSecretKey(unixTime, data);
            var headers = new Dictionary<string, string>
            {
                { "SecretKey", secretKey }
            };

            try
            {
                MultiServiceConnector multiServiceConnector = new MultiServiceConnector(ContestantBEConfigHelper.DeploymentCenterAPI);
                var body = await multiServiceConnector.ExecuteRequest("/api/challenge/stop", Method.Post, parammeters, headers);
                if (body == null)
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.BadRequest,
                        success = false,
                        message = "No response from server when stopping challenge"
                    };

                var result = JsonConvert.DeserializeObject<ChallengeDeployResponeDTO>(body);
                if (result == null)
                {
                    await Console.Out.WriteLineAsync("Failed to deserialize response");
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.InternalServerError,
                        success = false,
                        message = "Failed to parse server response"
                    };
                }
                return result;
            }
            catch (HttpRequestException e)
            {
                await Console.Out.WriteLineAsync($"Error connecting to API: {e.Message}");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.BadGateway,
                    success = false,
                    message = "Connection url failed"
                };
            }
        }

        public async Task<List<ChallengeInstanceDTO>> GetAllInstances(int teamId)
        {
            //var allPods = await _redisHelper.GetFromCacheAsync<List<PodInfo>>(RedisConfigs.PodsInfoKey) ?? new List<PodInfo>();
            //var teamPods = allPods.Where(p => p.TeamId == teamId).ToList();

            var teamDeployments = await _redisHelper.GetCacheByPatternAsync<ChallengeDeploymentCacheDTO>($"deploy_challenge_*_{teamId}");

            var instances = new List<ChallengeInstanceDTO>();

            foreach (var instance in teamDeployments)
            {
                var challenge = await _dbContext.Challenges
                    .FirstOrDefaultAsync(c => c.Id == instance.challenge_id);

                if (challenge != null)
                {
                    instances.Add(new ChallengeInstanceDTO
                    {
                        challenge_id = instance.challenge_id,
                        challenge_name = challenge.Name,
                        category = challenge.Category,
                        status = instance.status,
                        pod_name = "N/A",
                        ready = instance.ready,
                        age = instance.time_finished.ToString()
                    });
                }
            }

            return instances;
        }

        public async Task<ChallengeDeployResponeDTO> CheckChallengeStatus(int challengeId, int teamId)
        {
            var unixTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var data = new Dictionary<string, string>
            {
                { "challengeId", challengeId.ToString() },
                { "teamId", teamId.ToString()},
            };
            var parammeters = new ChallengCheckStatusReqDTO
            {
                challengeId = challengeId,
                teamId = teamId,
                unixTime = unixTime.ToString()
            };
            var secretKey = SecretKeyHelper.CreateSecretKey(unixTime, data);
            var headers = new Dictionary<string, string>
            {
                { "SecretKey", secretKey }
            };
            try
            {
                MultiServiceConnector multiServiceConnector = new MultiServiceConnector(ContestantBEConfigHelper.DeploymentCenterAPI);
                var body = await multiServiceConnector.ExecuteRequest("/api/statuscheck/start", Method.Post, parammeters, headers);
                if (body == null)
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.BadRequest,
                        success = false,
                        message = "No response from server when checking challenge status"
                    };

                var result = JsonConvert.DeserializeObject<ChallengeDeployResponeDTO>(body);
                if (result == null)
                {
                    await Console.Out.WriteLineAsync("Failed to deserialize response");
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.InternalServerError,
                        success = false,
                        message = "Failed to parse server response"
                    };
                }
                return result;
            }
            catch (HttpRequestException e)
            {
                await Console.Error.WriteLineAsync($"Error connecting to API: {e.Message}");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.BadGateway,
                    success = false,
                    message = "Connection url failed"
                };
            }
        }

        public async Task<ChallengeDeployResponeDTO> CheckChallengeStart(int challengeId, int teamId)
        {
            try
            {
                var deploymentKey = ChallengeHelper.GetCacheKey(challengeId,teamId);

                var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);

                if (deploymentCache == null)
                {
                    return new ChallengeDeployResponeDTO
                    {
                        success = false,
                        message = "No deployment info found.",
                        status = (int)HttpStatusCode.NotFound
                    };
                }

                var challenge = await _dbContext.Challenges.FirstOrDefaultAsync(c => c.Id == challengeId);
                if (challenge == null)
                {
                    return new ChallengeDeployResponeDTO
                    {
                        success = false,
                        message = "Challenge not found.",
                        status = (int)HttpStatusCode.NotFound
                    };
                }

                if (deploymentCache.status == Enums.DeploymentStatus.RUNING && deploymentCache.ready)
                {
                    
                    var result = new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.OK,
                        success = true,
                        message = "Pod is running.",
                        challenge_url = deploymentCache.challenge_url,
                        time_limit = challenge.TimeLimit ?? -1,
                    };
                    return result;
                }
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Pod is not running.",
                    status = (int)HttpStatusCode.OK
                };
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"Error during status check: {ex.Message}");
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Error during status check.",
                    status = (int)HttpStatusCode.InternalServerError,
                };
            }
        }
    }
}

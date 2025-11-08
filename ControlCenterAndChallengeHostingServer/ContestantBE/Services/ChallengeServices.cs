using ContestantBE.Utils;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using ResourceShared;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
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

namespace ContestantBE.Services
{
    public interface IChallengeServices
    {
        Task<ChallengeDeployResponeDTO> ChallengeStart(Challenge challenge, User user);

        Task<ChallengeDeployResponeDTO> ForceStopChallenge(int challengeId, User user);
        Task<BaseResponseDTO<ChallengeByIdDTO>> GetById(int challengeId, User user);
        Task<List<TopicDTO>> GetTopic(User user);

        Task<List<ChallengeByCategoryDTO>> GetChallengeByCategories(string cacategory_name, int? team_id);
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
                var user_chal = _dbContext.Users.FirstOrDefault(u => u.Id == cached_value.user_id);
                if (cached_value.challenge_id == challenge.Id)
                {
                    var time_finished = cached_value.time_finished;
                    var time_remaining = time_finished - (int)DateTimeOffset.Now.ToUnixTimeSeconds();
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
                        await Console.Out.WriteLineAsync($"Error parsing requirements for challenge {challenge.Id}: {ex.Message}");
                    }
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
                await Console.Out.WriteLineAsync($"Starting challenge {challenge.Id} for team {user.TeamId} by user {user.Id}");
                MultiServiceConnector multiServiceConnector = new MultiServiceConnector(ContestantBEConfigHelper.DeploymentCenterAPI);
                var body = await multiServiceConnector.ExecuteRequest("/api/challenge/start", Method.Post, parammeters, headers);
                await Console.Out.WriteLineAsync($"Response Line51 is {body}");
                if(body == null)
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
                await Console.Out.WriteLineAsync($"Start response: success={result.success}, message={result.message}, challenge_url={result.challenge_url}");
                return result;
                
            }
            catch (HttpRequestException ex)
            {
                await Console.Out.WriteLineAsync($"Error connecting to API: {ex.Message}");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.BadGateway,
                    success = false,
                    message = "Connection url failed"
                };
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync($"Unexpected error: {ex.Message}");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Unexpected error occurred"
                };
            }
        }

        public async Task<ChallengeDeployResponeDTO> ForceStopChallenge(int challengeId,User user)
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
                await Console.Out.WriteLineAsync($"Stop response: success={result.success}, message={result.message}, challenge_url={result.challenge_url}");
                return result;
            }
            catch(HttpRequestException e)
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
    }
}

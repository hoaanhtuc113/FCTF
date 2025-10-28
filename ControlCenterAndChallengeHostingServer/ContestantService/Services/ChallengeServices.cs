using ContestantService.Utils;
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
using System.Text.Json;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace ContestantService.Services
{
    public interface IChallengeServices
    {
        Task<ChallengeStartResponeDTO> ChallengeStart(Challenge challenge, User user);

        Task ForceStopChallenge(string cache_key, int challengeId, int teamId);
        Task<BaseResponseDTO<ChallengeByIdDTO>> GetById(int challengeId, User user);
        Task<List<TopicDTO>> GetTopic(User user);

        Task<List<ChallengeByCategoryDTO>> GetChallengeByCategories(string cacategory_name, int? team_id);
    }

    public class ChallengeServices : IChallengeServices
    {
        private readonly IConnectionMultiplexer _connectionMultiplexer;
        private readonly IHttpClientFactory _httpFactory;
        private readonly AppDbContext _dbContext;
        public static int port = 30000;
        public ChallengeServices(IConnectionMultiplexer connectionMultiplexer, IHttpClientFactory httpFactory, AppDbContext dbContext)
        {
            _connectionMultiplexer = connectionMultiplexer;
            _httpFactory = httpFactory;
            _dbContext=dbContext;
        }
        public async Task<BaseResponseDTO<ChallengeByIdDTO>> GetById(int challengeId, User user)
        {
            RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
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
            };

            var cache_key = ChallengeHelper.GetCacheKey(challenge.Id, user.Team.Id);
            if (await redisHelper.KeyExistsAsync(cache_key))
            {
                var cached_value = await redisHelper.GetFromCacheAsync<ChallengeCacheDTO>(cache_key);
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
                    requirements = challenge.Requirements,
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


        public async Task<ChallengeStartResponeDTO> ChallengeStart(Challenge challenge, User user)
        {
            RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
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
                    challengeName = "websecpro-chilp",
                    teamId = user.TeamId.Value,
                    teamName = user.Team.Name,
                    unixTime = unixTime.ToString()
                };
                var data = new Dictionary<string, string>
                {
                    { "challengeId", challenge.Id.ToString() },
                    { "challengeName", "websecpro-chilp" },
                    { "teamId", user.TeamId.Value.ToString() },
                    { "teamName", user.Team.Name },
                };
                string generatedSecretKey = SecretKeyHelper.CreateSecretKey(unixTime, data);

                var headers = new Dictionary<string, string>
                {
                    { "SecretKey", generatedSecretKey }
                };
                MultiServiceConnector multiServiceConnector = new MultiServiceConnector(ContestantServiceConfigHelper.DeploymentServiceAPI);
                var body = await multiServiceConnector.ExecuteRequest("/api/challenge/start", Method.Post, parammeters, headers);
                await Console.Out.WriteLineAsync($"Response Line51 is {body}");
                if(body == null)
                    return new ChallengeStartResponeDTO
                    {
                        status = (int)HttpStatusCode.BadRequest,
                        success = false,
                        message = "No response from server"
                    };

                var result = JsonConvert.DeserializeObject<ChallengeStartResponeDTO>(body);
                if (result == null)
                {
                    await Console.Out.WriteLineAsync("Failed to deserialize response");
                    return new ChallengeStartResponeDTO
                    {
                        status = (int)HttpStatusCode.InternalServerError,
                        success = false,
                        message = "Failed to parse server response"
                    };
                }
                await Console.Out.WriteLineAsync($"Start response: success={result.success}, message={result.message}, challenge_url={result.challenge_url}");
                return result;
                /*
                if (result.success)
                {
                    var timeFinished = DateTime.Now.AddMinutes(challenge.TimeLimit ?? -1);
                    var cache_key = ChallengeHelper.GetCacheKey(challenge.Id, user.TeamId.Value);
                    var cacheExpired = challenge.TimeLimit != null && challenge.TimeLimit > 0 ? TimeSpan.FromSeconds(challenge.TimeLimit.Value * 60) : (TimeSpan?)null;
                    try
                    {
                        await Console.Out.WriteLineAsync($"Saving to Redis: {cache_key} with expiration: {(cacheExpired.HasValue ? cacheExpired.ToString() : "No Expiration")}");
                        var cacheObj = new
                        {
                            challenge_url = result.challenge_url,
                            user_id = user.Id,
                            challengeId = challenge.Id,
                            time_finished = new DateTimeOffset(timeFinished).ToUnixTimeSeconds()
                        };
                        await redisHelper.SetCacheAsync(cache_key, cacheObj, cacheExpired);

                        var cachedData = await redisHelper.GetFromCacheAsync<object>(cache_key);
                        await Console.Out.WriteLineAsync($"Cache saved: {cache_key} -> challenge_url: {result.challenge_url}, time_finished: {timeFinished}");
                        
                        if(challenge.TimeLimit != null)
                        {
                            // tự đống stop challenge sau thời gian challenge.TimeLimit
                            //var delay = TimeSpan.FromSeconds(Math.Max(30, challenge.TimeLimit.Value * 60));
                            //_ = Task.Run(async () =>
                            //{
                            //    await Task.Delay(delay);
                            //    await ForceStopChallenge(cache_key, challenge.Id, user.TeamId.Value);
                            //});
                        }
                    }
                    catch(Exception ex)
                    {
                        await Console.Out.WriteLineAsync($"Error saving to Redis: {cache_key} - {ex.Message}");
                        return new ChallengeStartResponeDTO
                        {
                            status = (int)HttpStatusCode.NotFound,
                            success = false,
                            message = "Error saving to cache"
                        };
                    }

                    return new ChallengeStartResponeDTO
                    {
                        status = (int)HttpStatusCode.OK,
                        success = true,
                        message = "Challenge started successfully",
                        challenge_url = result.challenge_url
                    };
                }
                else
                {
                    var message = result.message;
       
                    message += "<br><br>Running challenge is: ";
                    var chalNames = _dbContext.Challenges
                                        .Where(c => c.Id == challenge.Id)
                                        .Select(c => $"<b>{c.Name}</b>")
                                        .ToList();
                    message += string.Join(", ", chalNames);

                    return new ChallengeStartResponeDTO
                    {
                        status = (int)HttpStatusCode.OK,
                        success = false,
                        message = message
                    };
                }
                */
            }
            catch (HttpRequestException ex)
            {
                await Console.Out.WriteLineAsync($"Error connecting to API: {ex.Message}");
                return new ChallengeStartResponeDTO
                {
                    status = (int)HttpStatusCode.BadGateway,
                    success = false,
                    message = "Connection url failed"
                };
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync($"Unexpected error: {ex.Message}");
                return new ChallengeStartResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Unexpected error occurred"
                };
            }
        }

        public async Task ForceStopChallenge(string cache_key, int challengeId, int teamId)
        {
            var unixTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var secretKey = SecretKeyHelper.CreateSecretKey(unixTime,new Dictionary<string, string> { 
                                                                            { "ChallengeId", challengeId.ToString() },
                                                                            { "TeamId", teamId.ToString() },
                                                                        });
            var payload = new
            {
                ChallengeId = challengeId,
                TeamId = teamId,
                UnixTime = unixTime
            };

            try
            {
                var parammeters = payload.GetType().GetProperties()
                               .ToDictionary(p => p.Name, p => p.GetValue(payload) ?? "");
                var headers = new Dictionary<string, string> { { "SecretKey", secretKey } };
                MultiServiceConnector multiServiceConnector = new MultiServiceConnector(ContestantServiceConfigHelper.ControlServerAPI);
                var body = await multiServiceConnector.ExecuteNormalRequest("/api/challenge/stop", Method.Post, parammeters, RequestContentType.Form, headers);
                if (body == null)
                {
                    await Console.Out.WriteLineAsync("No response from server when stopping challenge");
                    throw new Exception("No response from server when stopping challenge");
                }
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                bool isSuccess = root.GetProperty("isSuccess").GetBoolean();
                if (isSuccess)
                {
                    RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
                    await redisHelper.RemoveCacheAsync(cache_key);
                    await Console.Out.WriteLineAsync($"Challenge stopped and cache cleared: {cache_key}");
                }
                else
                {
                    await Console.Out.WriteLineAsync($"Failed to stop challenge: {root.GetProperty("message").GetString() ?? ""}");
                    throw new Exception($"Failed to stop challenge: {root.GetProperty("message").GetString() ?? ""}");
                }
            }
            catch(HttpRequestException e)
            {
                await Console.Out.WriteLineAsync($"Error connecting to API: {e.Message}");
                throw new Exception("Connection url failed" + e);
            }
            return;
        }
    }
}

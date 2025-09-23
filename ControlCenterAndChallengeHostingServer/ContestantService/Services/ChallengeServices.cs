using ContestantService.Utils;
using ResourceShared.DTOs.Challenge;
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
        Task<ChallengeStartResponeDTO> ChallengeStart(object payload, string secretKey, string apiStart, string cache_key, Challenge challenge, User user);

        Task ForceStopChallenge(string cache_key,  int challengeId, int teamId);
    }

    public class ChallengeServices : IChallengeServices
    {
        private readonly IConnectionMultiplexer _connectionMultiplexer;
        private readonly IHttpClientFactory _httpFactory;
        private readonly AppDbContext _dbContext;
        public ChallengeServices(IConnectionMultiplexer connectionMultiplexer, IHttpClientFactory httpFactory, AppDbContext dbContext)
        {
            _connectionMultiplexer = connectionMultiplexer;
            _httpFactory = httpFactory;
            _dbContext=dbContext;
        }
        public async Task<ChallengeStartResponeDTO> ChallengeStart(object payload, string secretKey, string apiStart, string cache_key, Challenge challenge, User user)
        {
            RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            };
            try
            {
                if(payload == null) return new ChallengeStartResponeDTO
                {
                    status = HttpStatusCode.BadRequest,
                    success = false,
                    message = "Invalid payload"
                };
                var parammeters = payload.GetType().GetProperties()
                               .ToDictionary(p => p.Name, p => p.GetValue(payload) ?? "");
                var headers = new Dictionary<string, string> { { "SecretKey", secretKey } };
                MultiServiceConnector multiServiceConnector = new MultiServiceConnector(ContestantServiceConfigHelper.ControlServerAPI);
                var body = await multiServiceConnector.ExecuteNormalRequest("/api/challenge/start", Method.Post, parammeters, RequestContentType.Form, headers);

                await Console.Out.WriteLineAsync($"Response Line51 is {body}");
                if(body == null)
                    return new ChallengeStartResponeDTO
                    {
                        status = HttpStatusCode.BadRequest,
                        success = false,
                        message = "No response from server"
                    };
                
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                bool isSuccess = root.GetProperty("isSuccess").GetBoolean();
                if (isSuccess)
                {
                    var data = JsonSerializer.Deserialize<GenaralViewResponseData<string>>(body, options);
                    var timeFinished = DateTime.Now.AddMinutes(challenge.TimeLimit ?? -1);

                    var cacheExpired = challenge.TimeLimit != null && challenge.TimeLimit > 0 ? TimeSpan.FromSeconds(challenge.TimeLimit.Value * 60) : (TimeSpan?)null;
                    try
                    {
                        await Console.Out.WriteLineAsync($"Saving to Redis: {cache_key} with expiration: {(cacheExpired.HasValue ? cacheExpired.ToString() : "No Expiration")}");
                        var cacheObj = new
                        {
                            challenge_url = data.data,
                            user_id = user.Id,
                            challenge_id = challenge.Id,
                            time_finished = new DateTimeOffset(timeFinished).ToUnixTimeSeconds()
                        };
                        await redisHelper.SetCacheAsync(cache_key, cacheObj, cacheExpired);

                        var cachedData = await redisHelper.GetFromCacheAsync<object>(cache_key);
                        await Console.Out.WriteLineAsync($"Cache saved: {cache_key} -> challenge_url: {JsonSerializer.Serialize(data.data)}, time_finished: {timeFinished}");
                        
                        if(challenge.TimeLimit != null)
                        {
                            // tự đống stop challenge sau thời gian challenge.TimeLimit
                            var delay = TimeSpan.FromSeconds(Math.Max(30, challenge.TimeLimit.Value * 60));
                            _ = Task.Run(async () =>
                            {
                                await Task.Delay(delay);
                                await ForceStopChallenge(cache_key, challenge.Id, user.TeamId.Value);
                            });
                        }
                    }
                    catch(Exception ex)
                    {
                        await Console.Out.WriteLineAsync($"Error saving to Redis: {cache_key} - {ex.Message}");
                        return new ChallengeStartResponeDTO
                        {
                            status = HttpStatusCode.NotFound,
                            success = false,
                            message = "Error saving to cache"
                        };
                    }
                    return new ChallengeStartResponeDTO
                    {
                        status = HttpStatusCode.OK,
                        success = true,
                        message = "Challenge started successfully",
                        challenge_url = data.data
                    };
                }
                else
                {
                    var data = JsonSerializer.Deserialize<GenaralViewResponseData<List<int>>>(body,options);
                    var message = data.Message;
                    var startedIds = data?.data ?? new List<int>();

                    if (startedIds.Any())
                    {
                        message += "<br><br>Running challenge is: ";
                        var chalNames = _dbContext.Challenges
                                         .Where(c => startedIds.Contains(c.Id))
                                         .Select(c => $"<b>{c.Name}</b>")
                                         .ToList();
                        message += string.Join(", ", chalNames);
                    }

                    return new ChallengeStartResponeDTO
                    {
                        status =HttpStatusCode.OK,
                        success = false,
                        message = message
                    };
                }
            }
            catch (HttpRequestException ex)
            {
                await Console.Out.WriteLineAsync($"Error connecting to API: {ex.Message}");
                return new ChallengeStartResponeDTO
                {
                    status = HttpStatusCode.OK,
                    success = false,
                    message = "Connection url failed"
                };
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync($"Unexpected error: {ex.Message}");
                return new ChallengeStartResponeDTO
                {
                    status = HttpStatusCode.InternalServerError,
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

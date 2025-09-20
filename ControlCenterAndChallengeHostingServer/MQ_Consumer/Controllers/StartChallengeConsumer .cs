using MassTransit;
using MQ_Consumer.Configs;
using Newtonsoft.Json;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.Models;
using ResourceShared.ResponseViews;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;

public class StartChallengeConsumer : IConsumer<StartChallengeInstanceRequest>
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _config;
    private readonly IConnectionMultiplexer _connectionMultiplexer;

    public StartChallengeConsumer(
        IHttpClientFactory httpClientFactory,
        IConfiguration config,
        IConnectionMultiplexer connectionMultiplexer)
    {
        _httpClientFactory = httpClientFactory;
        _config = config;
        _connectionMultiplexer = connectionMultiplexer;
    }

    public async Task Consume(ConsumeContext<StartChallengeInstanceRequest> context)
    {
        RedisHelper _redis = new RedisHelper(_connectionMultiplexer);
        string key = $"{RedisConfigs.RedisStartedChallengeKey}_{context.Message.ChallengeId}_{context.Message.TeamId}";
        string redisDeployKey = $"{RedisConfigs.RedisDeployKey}{context.Message.ChallengeId}";

        var redisGetDeployInfo = await _redis.GetFromCacheAsync<DeploymentInfo>(redisDeployKey);
        if (redisGetDeployInfo == null || redisGetDeployInfo.LastDeployTime == null)
        {
            await Console.Out.WriteLineAsync($"[ERR] Challenge {context.Message.ChallengeId} is not yet deployed, can't start");
            DeploymentInfo deploymentInfo = new DeploymentInfo
            {
                ChallengeId = context.Message.ChallengeId,
                TeamId = context.Message.TeamId,
                Status = "Failed",
            };
            await _redis.SetCacheAsync(key, JsonConvert.SerializeObject(deploymentInfo), TimeSpan.FromSeconds(90));
            return;
        }
        #region Tìm Challenge Server đã deploy target challenge 
        var challengeHostServer = ControlCenterServiceConfig.ChallengeServerInfoList.FirstOrDefault(c => c.ServerId == redisGetDeployInfo.ServerId);
        if (challengeHostServer == null)
        {
            await Console.Out.WriteLineAsync($"[ERR] Config of Challenge Hosting Platform in Control Center Platform is invalid, please check then try again");
            DeploymentInfo deploymentInfo = new DeploymentInfo
            {
                ChallengeId = context.Message.ChallengeId,
                TeamId = context.Message.TeamId,
                Status = "Failed",
            };
            await _redis.SetCacheAsync(key, JsonConvert.SerializeObject(deploymentInfo), TimeSpan.FromSeconds(90));
            return;
        }
        #endregion

        var startRequest = new RestRequest();
        startRequest.Method = Method.Post;
        startRequest.Resource = "api/challenge/start";

        long unixTime = DateTimeHelper.GetDateTimeNowInUnix();
        var instanceInfoJson = JsonConvert.SerializeObject(context.Message);
        var DictScrKey = JsonConvert.DeserializeObject<Dictionary<string, string>>(instanceInfoJson);
        var DictMultiService = JsonConvert.DeserializeObject<Dictionary<string, object>>(instanceInfoJson);


        if (DictScrKey == null || DictMultiService == null)
        {
            throw new Exception("Convert from obj instance info to dict failed");
        }

        if (!DictMultiService.ContainsKey("UnixTime"))
        {
            DictMultiService.Add("UnixTime", unixTime);
        }
        string secretKeyStartChallenge = SecretKeyHelper.CreateSecretKey(unixTime, DictScrKey);

        startRequest.AddHeader("SecretKey", secretKeyStartChallenge);
        string baseDeployUrl = challengeHostServer.ServerHost + ":" + challengeHostServer.ServerPort;
       
        MultiServiceConnector connector = new MultiServiceConnector(baseDeployUrl);
        GenaralViewResponseData<DeploymentInfo>? startResult
          = await connector.ExecuteRequest<GenaralViewResponseData<DeploymentInfo>>(startRequest, DictMultiService, RequestContentType.Form);
        var entity = await _redis.GetFromCacheAsync<DeploymentInfo>(key);

        if (startResult != null && startResult.IsSuccess && startResult.data != null)
        {
            DeploymentInfo challengeInstance = startResult.data;
            challengeInstance.Status = "running";
            await _redis.SetCacheAsync(key, challengeInstance, TimeSpan.MaxValue);

            await Console.Out.WriteLineAsync($"[OK] Started challenge {context.Message.ChallengeId} for team {context.Message.TeamId}");
            await Console.Out.WriteLineAsync($"[OK] Data challenge: {JsonConvert.SerializeObject(await _redis.GetFromCacheAsync<DeploymentInfo>(key))}");

            // TEMP
            // luu redis cho admnin check
            var adminKey = $"challenge_url_{context.Message.ChallengeId}_{context.Message.TeamId}";
            var data = new
            {
                challenge_url = challengeInstance.DeploymentDomainName,
                user_id = challengeInstance.TeamId, // sửa thành user_id              
                challenge_id = challengeInstance.ChallengeId,
                time_finished = challengeInstance.EndTime.HasValue ? (int)new DateTimeOffset(challengeInstance.EndTime.Value).ToUnixTimeSeconds() : 0
            };
            // thoi gian het han
            TimeSpan? adminKeyExpiry = null;
            if (challengeInstance.EndTime.HasValue)
            {
                var ts = challengeInstance.EndTime.Value.ToUniversalTime() - DateTime.UtcNow;
                adminKeyExpiry = ts > TimeSpan.Zero ? ts : TimeSpan.FromSeconds(1);
            }
            await _redis.SetCacheAsync(adminKey,data,adminKeyExpiry ?? TimeSpan.MaxValue);
        }
        else
        {
            if(entity != null)
            {
                entity.Status = "Failed";
                await _redis.SetCacheAsync(key, JsonConvert.SerializeObject(entity), TimeSpan.FromSeconds(90));
            }
            else
            {
                DeploymentInfo deploymentInfo = new DeploymentInfo
                {
                    ChallengeId = context.Message.ChallengeId,
                    TeamId = context.Message.TeamId,
                    Status = "Failed",
                };
                await _redis.SetCacheAsync(key, JsonConvert.SerializeObject(deploymentInfo), TimeSpan.FromSeconds(90));
            }
            await Console.Out.WriteLineAsync($"[ERR] API call failed: { startResult.Message}");
        }
    }
}

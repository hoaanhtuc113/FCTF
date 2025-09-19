using MassTransit;
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
        var startRequest = new RestRequest();
        startRequest.Method = Method.Post;
        RedisHelper _redis = new RedisHelper(_connectionMultiplexer);
        string key = $"{RedisConfigs.RedisStartedChallengeKey}_{context.Message.ChallengeId}_{context.Message.TeamId}";
        var apiUrl = _config["Api:Url"];
        //var client = _httpClientFactory.CreateClient();

        //// send request to API (challenge server or jenkins) to start challenge
        //using var form = new MultipartFormDataContent
        //{
        //    { new StringContent(context.Message.ChallengeId.ToString()), nameof(StartChallengeInstanceRequest.ChallengeId) },
        //    { new StringContent(context.Message.TeamId.ToString()), nameof(StartChallengeInstanceRequest.TeamId) },
        //    { new StringContent(context.Message.TimeLimit.ToString()), nameof(StartChallengeInstanceRequest.TimeLimit) },
        //    { new StringContent(context.Message.ImageLink ?? "{}"), nameof(StartChallengeInstanceRequest.ImageLink) }
        //};

        //var request = new HttpRequestMessage(HttpMethod.Post, $"{apiUrl}")
        //{
        //    Content = form
        //};
        //Console.WriteLine("Key: "+context.Message.SecretKey);
        //request.Headers.Add("SecretKey", context.Message.SecretKey);

        //var response = await client.SendAsync(request);
        var instanceInfoJson = JsonConvert.SerializeObject(context.Message);
        Console.WriteLine($"context.Message: {(context.Message)}");
        var DictScrKey = JsonConvert.DeserializeObject<Dictionary<string, string>>(instanceInfoJson);
        var DictMultiService = JsonConvert.DeserializeObject<Dictionary<string, object>>(instanceInfoJson);
        long unixTime = DateTimeHelper.GetDateTimeNowInUnix();
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

        MultiServiceConnector connector = new MultiServiceConnector(apiUrl);
        GenaralViewResponseData<DeploymentInfo>? startResult
          = await connector.ExecuteRequest<GenaralViewResponseData<DeploymentInfo>>(startRequest, DictMultiService, RequestContentType.Form);
        var entity = await _redis.GetFromCacheAsync<DeploymentInfo>(key);
        if (!(startResult == null || !startResult.IsSuccess || startResult.data == null))
        {
            DeploymentInfo challengeInstance = startResult.data;
            challengeInstance.Status = "running";
            await _redis.SetCacheAsync(key, challengeInstance, TimeSpan.MaxValue);

            await Console.Out.WriteLineAsync($"[OK] Started challenge {context.Message.ChallengeId} for team {context.Message.TeamId}");
            await Console.Out.WriteLineAsync($"[OK] Data challenge: {JsonConvert.SerializeObject(await _redis.GetFromCacheAsync<DeploymentInfo>(key))}");
        }
        else
        {
            if(entity != null)
            {
                entity.Status = "failed";
                await _redis.SetCacheAsync(key, JsonConvert.SerializeObject(entity), TimeSpan.FromDays(90));
            }
            else
            {
                DeploymentInfo deploymentInfo = new DeploymentInfo
                {
                    ChallengeId = context.Message.ChallengeId,
                    TeamId = context.Message.TeamId,
                    Status = "failed",
                };
                await _redis.SetCacheAsync(key, JsonConvert.SerializeObject(deploymentInfo), TimeSpan.FromDays(90));
            }


            await Console.Out.WriteLineAsync($"[ERR] API call failed: { startResult.Message}");
        }
    }
}

using MassTransit;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.Models;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Text.Json;

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
        var apiUrl = _config["Api:Url"];
        var client = _httpClientFactory.CreateClient();

        // send request to API (challenge server or jenkins) to start challenge
        using var form = new MultipartFormDataContent
        {
            { new StringContent(context.Message.ChallengeId.ToString()), nameof(StartChallengeInstanceRequest.ChallengeId) },
            { new StringContent(context.Message.TeamId.ToString()), nameof(StartChallengeInstanceRequest.TeamId) },
            { new StringContent(context.Message.TimeLimit.ToString()), nameof(StartChallengeInstanceRequest.TimeLimit) },
            { new StringContent(context.Message.ImageLink ?? "{}"), nameof(StartChallengeInstanceRequest.ImageLink) }
        };

        var request = new HttpRequestMessage(HttpMethod.Post, $"{apiUrl}")
        {
            Content = form
        };
        request.Headers.Add("SecretKey", context.Message.SecretKey);

        var response = await client.SendAsync(request);
        DeploymentInfo? entity = await _redis.GetFromCacheAsync<DeploymentInfo>(key);
        if (response.IsSuccessStatusCode&& entity != null)
        {
            entity.Status = "done";
            await _redis.SetCacheAsync(key, JsonSerializer.Serialize(entity), TimeSpan.FromDays(90));

            await Console.Out.WriteLineAsync($"[OK] Started challenge {context.Message.ChallengeId} for team {context.Message.TeamId}");
        }
        else
        {
            if(entity != null)
            {
                entity.Status = "failed";
                await _redis.SetCacheAsync(key, JsonSerializer.Serialize(entity), TimeSpan.FromDays(90));
            }
            else
            {
                DeploymentInfo deploymentInfo = new DeploymentInfo
                {
                    ChallengeId = context.Message.ChallengeId,
                    TeamId = context.Message.TeamId,
                    Status = "failed",
                };
                await _redis.SetCacheAsync(key, JsonSerializer.Serialize(deploymentInfo), TimeSpan.FromDays(90));
            }


            await Console.Out.WriteLineAsync($"[ERR] API call failed: {response.StatusCode} - {await response.Content.ReadAsStringAsync()}");
        }
    }
}

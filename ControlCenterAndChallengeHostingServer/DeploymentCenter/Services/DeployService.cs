using DeploymentCenter.Utils;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using ResourceShared.Services;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Net;
using System.Text.Json;
using static ResourceShared.Enums;

namespace DeploymentCenter.Services
{
    public interface IDeployService
    {
        Task<ChallengeStartResponeDTO> Start(int challengId, string challengName, string teamName);
    }
    public class DeployService : IDeployService
    {
        private readonly IConnectionMultiplexer _connectionMultiplexer;
        private readonly IK8sHealthService _k8SHealthService;
        private readonly AppDbContext _dbContext;
        public DeployService(IConnectionMultiplexer connectionMultiplexer, AppDbContext dbContext)
        {
            _connectionMultiplexer = connectionMultiplexer;
            _dbContext=dbContext;
            //_k8SHealthService = k8SHealthService;
        }
        public async Task<ChallengeStartResponeDTO> Start(int challengId, string challengName, string teamName)
        {
            RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);
            var startedKey = ChallengeHelper.GetArgoWName(challengId.ToString(), teamName);

            var cache = await redisHelper.GetFromCacheAsync<DeploymentInfo>(startedKey);

            if (cache != null)
            {
                switch (cache.Status)
                {
                    case DeploymentStatus.PROCESS:
                        return new ChallengeStartResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Challenge is deploying. Please wait a moment."
                        };
                    case DeploymentStatus.RUNING:

                        var podName = ChallengeHelper.GetDeploymentAppName(teamName, challengId.ToString(), challengName);

                        //var podStatus = await _k8SHealthService.CheckPodAliveAsync(podName, "challenge");
                        var podStatus = true;
                        if (!podStatus)
                        {
                            return new ChallengeStartResponeDTO
                            {
                                status = (int)HttpStatusCode.OK,
                                success = true,
                                message = "Challenge is deploying. Please wait a moment."
                            };
                        }

                        return new ChallengeStartResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Challenge is already deployed.",
                            challenge_url = cache.DeploymentDomainName,
                        };
                    default:
                        await Console.Out.WriteLineAsync($"Unknown deployment status: {cache.Status}");
                        break;
                }
            }
            var challenge = _dbContext.Challenges.FirstOrDefault(c => c.Id == challengId);
            if (challenge == null)
            {
                return new ChallengeStartResponeDTO
                {
                    status = (int)HttpStatusCode.NotFound,
                    success = false,
                    message = "Challenge not found."
                };
            }
            try
            {
                var headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {DeploymentCenterConfigHelper.ARGO_WORKFLOWS_TOKEN}" };
                var jsonImageLink = challenge.ImageLink;
                if (jsonImageLink == null)
                    return new ChallengeStartResponeDTO
                    {
                        status = (int)HttpStatusCode.BadRequest,
                        success = false,
                        message = "Challenge image link is null."
                    };

                var imageObj = JsonSerializer.Deserialize<ChallengeImageDTO>(jsonImageLink);

                if (imageObj == null) 
                    return new ChallengeStartResponeDTO
                    {
                        status = (int)HttpStatusCode.BadRequest,
                        success = false,
                        message = "Challenge image link is invalid."
                    };
               
                var payload = ChallengeHelper.BuildArgoPayload(
                        challenge,
                        teamName,
                        imageObj,
                        DeploymentCenterConfigHelper.CPU_LIMIT,
                        DeploymentCenterConfigHelper.CPU_REQUEST,
                        DeploymentCenterConfigHelper.MEMORY_LIMIT,
                        DeploymentCenterConfigHelper.MEMORY_REQUEST,
                        DeploymentCenterConfigHelper.POD_START_TIMEOUT_MINUTES);
                
                var api = DeploymentCenterConfigHelper.ARGO_WORKFLOWS_URL + "/submit";
                await Console.Out.WriteLineAsync($"Payload to Argo Workflows API: {JsonSerializer.Serialize(payload)}");
                await Console.Out.WriteLineAsync($"Argo Workflows API: {DeploymentCenterConfigHelper.ARGO_WORKFLOWS_URL}");

                MultiServiceConnector multiServiceConnector = new MultiServiceConnector(api);
                var response = await multiServiceConnector.ExecuteRequest(api, Method.Post, payload, headers);
                await Console.Out.WriteLineAsync($"Response from Argo Workflows API: {response}");
                if (response == null)
                {
                    await Console.Out.WriteLineAsync("No response from Argo Workflows API");
                    return new ChallengeStartResponeDTO
                    {
                        status = (int)HttpStatusCode.BadRequest,
                        success = false,
                        message = "No response from server"
                    };
                }

                return new ChallengeStartResponeDTO
                {
                    status = (int)HttpStatusCode.OK,
                    success = true,
                    message = "Send to Argo Workflows to deploy successfully.",
                };
            }
            catch (HttpRequestException ex)
            {
                await Console.Error.WriteLineAsync($"Error connecting to API: {ex.Message}");
                return new ChallengeStartResponeDTO
                {
                    status = (int)HttpStatusCode.BadGateway,
                    success = false,
                    message = "Connect to argo workflow fail."
                };
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"Unexpected error: {ex.Message}");
                return new ChallengeStartResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Unexpected error occurred."
                };
            }
        }
    }
}

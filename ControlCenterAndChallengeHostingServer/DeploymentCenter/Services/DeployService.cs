using DeploymentCenter.Utils;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using ResourceShared.Services;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Net;
using System.Security.AccessControl;
using System.Text.Json;
using static ResourceShared.Enums;

namespace DeploymentCenter.Services
{
    public interface IDeployService
    {
        Task<ChallengeStartResponeDTO> Start(ChallengeStartStopReqDTO challengeStartReq);
    }
    public class DeployService : IDeployService
    {
        private readonly IK8sHealthService _k8SHealthService;
        private readonly AppDbContext _dbContext;
        private readonly RedisHelper _redisHelper;
        public DeployService(AppDbContext dbContext, RedisHelper redisHelper)
        {
            _dbContext=dbContext;
            _redisHelper=redisHelper;
            //_k8SHealthService = k8SHealthService;
        }
        public async Task<ChallengeStartResponeDTO> Start(ChallengeStartStopReqDTO startReq)
        {
            var startedKey = ChallengeHelper.GetArgoWName(startReq.challengeId.ToString(), startReq.teamName);
            // Get cache: thông tin deployment, kiểm tra đã từng gửi vào argo chưa
            var deploymentCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(startedKey);

            if (deploymentCache != null)
            {
                switch (deploymentCache.Status)
                {
                    case DeploymentStatus.PROCESS:
                        return new ChallengeStartResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Challenge is deploying. The domain bellow may not be immediately accessible.",
                            challenge_url = deploymentCache.DeploymentDomainName,

                        };
                    case DeploymentStatus.RUNING:

                        var podName = deploymentCache.PodName;

                        //var podStatus = await _k8SHealthService.CheckPodAliveAsync(podName, "challenge");
                        var podStatus = true;
                        if (!podStatus)
                        {
                            return new ChallengeStartResponeDTO
                            {
                                status = (int)HttpStatusCode.OK,
                                success = true,
                                message = "Challenge is deploying. The domain bellow may not be immediately accessible.",
                                challenge_url = deploymentCache.DeploymentDomainName,
                            };
                        }

                        return new ChallengeStartResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Challenge is already deployed.",
                            challenge_url = deploymentCache.DeploymentDomainName,
                        };
                    default:
                        await Console.Out.WriteLineAsync($"Unknown deployment status: {deploymentCache.Status}");
                        break;
                }
            }
            var challenge = _dbContext.Challenges.FirstOrDefault(c => c.Id == startReq.challengeId);
            if (challenge == null) 
                return new ChallengeStartResponeDTO{ status = (int)HttpStatusCode.NotFound, success = false, message = "Challenge not found."};
            
            try
            {
                var headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {DeploymentCenterConfigHelper.ARGO_WORKFLOWS_TOKEN}" };
                var jsonImageLink = challenge.ImageLink;
                if (jsonImageLink == null)
                    return new ChallengeStartResponeDTO{ status = (int)HttpStatusCode.BadRequest, success = false, message = "Challenge image link is null." };

                var imageObj = JsonSerializer.Deserialize<ChallengeImageDTO>(jsonImageLink);

                if (imageObj == null) 
                    return new ChallengeStartResponeDTO { status = (int)HttpStatusCode.BadRequest, success = false, message = "Challenge image link is invalid." };
               
                var (payload, appName) = ChallengeHelper.BuildArgoPayload(
                        challenge,
                        startReq.teamName,
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
                    return new ChallengeStartResponeDTO { status = (int)HttpStatusCode.BadRequest, success = false, message = "No response from server" };
                }
                var domainName = $"http://{appName}.challenge-zg9uj3rfagfja19tzq.fctf.cloud";

                // Save cache: thông tin deployment khi bắm vào argo 
                await _redisHelper.SetCacheAsync(startedKey, new DeploymentInfo
                {
                    Status = DeploymentStatus.PROCESS,
                    ChallengeId = startReq.challengeId,
                    PodName = appName,
                    DeploymentDomainName = domainName,
                });

                var timeFinished = DateTime.Now.AddMinutes(challenge.TimeLimit ?? -1);


                ChallengeDeploymentCacheDTO  chalDeploy = new ChallengeDeploymentCacheDTO
                {
                    challenge_id = startReq.challengeId,
                    user_id = startReq.userId.Value,
                    status = DeploymentStatus.PROCESS,
                    challenge_url = domainName,
                    time_finished = -1
                };
                // khi nào thực sự lên thì cập nhật lại status và time_finished

                // Save cache: thông tin tạm thông tin deployment với trạng thái processing và thời gian kết thúc -1 
                // Để bên admin có thể xem được thông tin này
                await _redisHelper.SetCacheAsync(ChallengeHelper.GetCacheKey(startReq.challengeId, startReq.teamId), chalDeploy, TimeSpan.FromHours(1));

                return new ChallengeStartResponeDTO
                {
                    status = (int)HttpStatusCode.OK,
                    success = true,
                    message = "Send to request to deploy successfully. The domain bellow may not be immediately accessible.",
                    challenge_url = domainName
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

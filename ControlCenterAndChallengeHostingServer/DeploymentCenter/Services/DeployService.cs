using DeploymentCenter.Utils;
using Microsoft.EntityFrameworkCore;
using ResourceShared;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Models;
using ResourceShared.Services;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Net;
using System.Net.WebSockets;
using System.Security.AccessControl;
using System.Text.Json;
using static ResourceShared.Enums;

namespace DeploymentCenter.Services
{
    public interface IDeployService
    {
        Task<ChallengeDeployResponeDTO> Start(ChallengeStartStopReqDTO challengeStartReq);
        Task<ChallengeDeployResponeDTO> Stop(ChallengeStartStopReqDTO challengeStartReq);
        Task<ChallengeDeployResponeDTO> StatusCheck(ChallengCheckStatusReqDTO statusReq);
        
        Task<BaseResponseDTO> HandleMessageFromArgo(WorkflowStatusDTO message);
    }
    public class DeployService : IDeployService
    {
        private readonly IK8sHealthService _k8SHealthService;
        private readonly AppDbContext _dbContext;
        private readonly RedisHelper _redisHelper;
        public DeployService(AppDbContext dbContext, RedisHelper redisHelper ,  IK8sHealthService k8SHealthService )
        {
            _dbContext=dbContext;
            _redisHelper=redisHelper;
            //K8S-NOTE: comment this state for runing in local with out k8s cubeconfig 
            _k8SHealthService = k8SHealthService;
        }

        public async Task<ChallengeDeployResponeDTO> Start(ChallengeStartStopReqDTO startReq)
        {
            var startedKey = ChallengeHelper.GetArgoWName(startReq.challengeId.ToString(), startReq.teamName);
            // Get cache: thông tin deployment, kiểm tra đã từng gửi vào argo chưa
            var deploymentCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(startedKey);

            if (deploymentCache != null)
            {
                switch (deploymentCache.Status)
                {
                    case DeploymentStatus.PROCESS:
                        return new ChallengeDeployResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Challenge is deploying. The domain bellow may not be immediately accessible.",
                            challenge_url = deploymentCache.DeploymentDomainName,

                        };
                    case DeploymentStatus.RUNING:

                        var podName = deploymentCache.PodName;

                        var podStatus = await _k8SHealthService.CheckPodAliveAsync(podName);
                        //var podStatus = true;
                        if (!podStatus)
                        {
                            return new ChallengeDeployResponeDTO
                            {
                                status = (int)HttpStatusCode.OK,
                                success = true,
                                message = "Challenge is deploying. The domain bellow may not be immediately accessible.",
                                challenge_url = deploymentCache.DeploymentDomainName,
                            };
                        }

                        return new ChallengeDeployResponeDTO
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
                return new ChallengeDeployResponeDTO { status = (int)HttpStatusCode.NotFound, success = false, message = "Challenge not found." };

            try
            {
                var headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {DeploymentCenterConfigHelper.ARGO_WORKFLOWS_TOKEN}" };
                var jsonImageLink = challenge.ImageLink;
                if (jsonImageLink == null)
                    return new ChallengeDeployResponeDTO { status = (int)HttpStatusCode.BadRequest, success = false, message = "Challenge image link is null." };

                var imageObj = JsonSerializer.Deserialize<ChallengeImageDTO>(jsonImageLink);

                if (imageObj == null)
                    return new ChallengeDeployResponeDTO { status = (int)HttpStatusCode.BadRequest, success = false, message = "Challenge image link is invalid." };

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
                    return new ChallengeDeployResponeDTO { status = (int)HttpStatusCode.BadRequest, success = false, message = "No response from server" };
                }
                var domainName = $"http://{appName}.challenge-zg9uj3rfagfja19tzq.fctf.cloud";

                // Save cache: thông tin deployment khi bắm vào argo 
                await _redisHelper.SetCacheAsync(startedKey, new DeploymentInfo
                {
                    Status = DeploymentStatus.PROCESS,
                    ChallengeId = startReq.challengeId,
                    TeamId = startReq.teamId,
                    PodName = appName,
                    DeploymentDomainName = domainName,
                });

                var timeFinished = DateTime.Now.AddMinutes(challenge.TimeLimit ?? -1);


                ChallengeDeploymentCacheDTO chalDeploy = new ChallengeDeploymentCacheDTO
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

                var checkCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(ChallengeHelper.GetCacheKey(startReq.challengeId, startReq.teamId));
                await Console.Out.WriteLineAsync($"Deployment info save success: {JsonSerializer.Serialize(checkCache)}");

                return new ChallengeDeployResponeDTO
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
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.BadGateway,
                    success = false,
                    message = "Connect to argo workflow fail."
                };
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"Unexpected error: {ex.Message}");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Unexpected error occurred."
                };
            }
        }

        public async Task<ChallengeDeployResponeDTO> Stop(ChallengeStartStopReqDTO stopReq)
        {
            await Console.Out.WriteLineAsync($"Stop challenge ID: {stopReq.challengeId}, Team ID: {stopReq.teamId}, Team Name: {stopReq.teamName}");
            try
            {
                var deployInfo = ChallengeHelper.GetCacheKey(stopReq.challengeId, stopReq.teamId);
                var argoWNameKey = ChallengeHelper.GetArgoWName(stopReq.challengeId.ToString(), stopReq.teamName);
                var checkCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(deployInfo);

                if (checkCache == null || argoWNameKey == null) 
                {
                    await Console.Error.WriteLineAsync($"No deployment cache info found for with cache key {checkCache} and {argoWNameKey} ");
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.NotFound,
                        success = false,
                        message = "No deployment cache info found for the specified challenge and team."
                    };
                }
                //K8S-NOTE: comment this state for runing in local with out k8s cubeconfig 
                var isDelete = await _k8SHealthService.DeleteNamespaceAsync(checkCache.PodName);
                //var isDelete = true;
                if (isDelete)
                {
                    await _redisHelper.RemoveCacheAsync(deployInfo);
                    await _redisHelper.RemoveCacheAsync(argoWNameKey);
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.OK,
                        success = true,
                        message = "Challenge stopped and resources cleaned up successfully."
                    };
                }
              
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Failed to delete challenge resources."
                };
                
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"Error during stopping challenge: {ex.Message}");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Error during stopping challenge."
                };
            }
        }

        public async Task<ChallengeDeployResponeDTO> StatusCheck(ChallengCheckStatusReqDTO statusReq)
        {

            //K8S-NOTE: this state for runing in local with out k8s cubeconfig 
            // return new ChallengeDeployResponeDTO
            // {
            //     success = true,
            //     message = "Challenge status checking started",
            //     status = (int)HttpStatusCode.OK,
            //     challenge_url = "http://demo-domain-for-testing.com"

            // };
            try
            {
                var startedKey = ChallengeHelper.GetArgoWName(statusReq.challengeId.ToString(), statusReq.teamName);

                var deploymentCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(startedKey);

                await Console.Out.WriteLineAsync($"Data from Redis for key {startedKey}: {JsonSerializer.Serialize(deploymentCache)}");
                if (deploymentCache == null)
                {
                    await Console.Out.WriteLineAsync($"No deployment info found in cache for key: {startedKey} ");
                    return new ChallengeDeployResponeDTO
                    {
                        success = false,
                        message = "No deployment info found.",
                        status = (int)HttpStatusCode.NotFound
                    };
                }

                var podName = deploymentCache.PodName;

                var podStatus = await _k8SHealthService.CheckPodAliveAsync(podName);

                if (podStatus)
                {
                    // Cập nhật lại DeploymentInfo status =  RUNING
                    deploymentCache.Status = DeploymentStatus.RUNING;
                    await _redisHelper.SetCacheAsync(startedKey, deploymentCache);

                    // Thực sự lên cập nhật lại status và time_finished
                    var chalDeployKey = ChallengeHelper.GetCacheKey(deploymentCache.ChallengeId, deploymentCache.TeamId);
                    var chalDeploy = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(chalDeployKey);
                    if (chalDeploy != null)
                    {
                        chalDeploy.status = DeploymentStatus.RUNING;
                        var challenge = _dbContext.Challenges.FirstOrDefault(c => c.Id == statusReq.challengeId);
                        var cacheExpired = challenge.TimeLimit != null && challenge.TimeLimit > 0 ? TimeSpan.FromSeconds(challenge.TimeLimit.Value * 60) : (TimeSpan?)null;

                        await _redisHelper.SetCacheAsync(chalDeployKey, chalDeploy, cacheExpired);
                    }
                    return new ChallengeDeployResponeDTO
                    {
                        success = true,
                        message = "Challenge is running.",
                        status =  (int)HttpStatusCode.OK,
                        challenge_url = deploymentCache.DeploymentDomainName
                    };
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

        public async Task<BaseResponseDTO> HandleMessageFromArgo(WorkflowStatusDTO message)
        {
            if (message.Type == Enums.ArgoMessageType.UP)
            {
                return await HandleUpChallengeMessage(message);
            }
            else if (message.Type == Enums.ArgoMessageType.START)
            {
                return await HandleStartChallengeMessage(message);
            }
            else
            {
                await Console.Error.WriteLineAsync($"Recieve Message From Argo: Unsupported message type {message.Type}");
                return new BaseResponseDTO
                {
                    Success = false,
                    Message = "Unsupported message type",
                    HttpStatusCode = HttpStatusCode.BadRequest
                };
            }
        }

        private async Task<BaseResponseDTO> HandleUpChallengeMessage(WorkflowStatusDTO message)
        {
            try
            {
                var challenge = await _dbContext.Challenges.FirstOrDefaultAsync(c => c.Id == message.ChallengeId);
                if (challenge == null)
                {
                    await Console.Error.WriteLineAsync($"Recieve Message From Argo: challenge with ID {message.ChallengeId} not found.");
                    return new BaseResponseDTO
                    {
                        Success = false,
                        Message = "Challenge not found",
                        HttpStatusCode = HttpStatusCode.NotFound
                    };
                }

                var deploystatus = Enums.GetDeploymentStatus(message.Status ?? "");

                challenge.DeployStatus =  deploystatus;

                if (deploystatus == Enums.DeploymentStatus.SUCCEEDED)
                {
                    challenge.State = Enums.ChallengeState.VISIBLE;
                }

                var History = new DeployHistory
                {
                    ChallengeId = message.ChallengeId.Value,
                    DeployStatus = deploystatus,
                    DeployAt = DateTime.UtcNow,
                    LogContent = "WorkFlowName: " + message.WorkFlowName + "\n" +"\n" + "Status: " + message.Status
                };

                _dbContext.Challenges.Update(challenge);
                await _dbContext.DeployHistories.AddAsync(History);
                await _dbContext.SaveChangesAsync();

                return new BaseResponseDTO
                {
                    Success = true,
                    Message = "Message from Argo processed successfully",
                    HttpStatusCode = HttpStatusCode.OK
                };
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"Recieve Message From Argo Error: {ex.Message}");
                return new BaseResponseDTO
                {
                    Success = false,
                    Message = "Internal server error",
                    HttpStatusCode = HttpStatusCode.InternalServerError
                };
            }
        }

        private async Task<BaseResponseDTO> HandleStartChallengeMessage(WorkflowStatusDTO message)
        {

            if (string.IsNullOrEmpty(message.WorkFlowName))
            {
                return new BaseResponseDTO
                {
                    Success = false,
                    HttpStatusCode = HttpStatusCode.InternalServerError,
                    Message = "Workflow name not found"
                };
            }

            if (message.Status == Enums.DeploymentStatus.FAILED)
            {
                // Xóa thông tin deployment khi bắm vào argo khi workflow chạy lỗi
                var isRemove  =  await _redisHelper.RemoveCacheAsync(message.WorkFlowName);
                return new BaseResponseDTO
                {
                    Success = isRemove,
                    HttpStatusCode = HttpStatusCode.OK,
                    Message = "Start challenge workflow failed, remove deployment cache"
                };
            }

            return new BaseResponseDTO
            {
                Success = true,
                HttpStatusCode = HttpStatusCode.OK,
                Message = "Start challenge workflow success"
            };
        }
    }
}

using DeploymentCenter.Utils;
using Microsoft.EntityFrameworkCore;
using ResourceShared;
using ResourceShared.Configs;
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
        private readonly IK8sService _k8SHealthService;
        private readonly AppDbContext _dbContext;
        private readonly RedisHelper _redisHelper;
        public DeployService(AppDbContext dbContext, RedisHelper redisHelper ,  IK8sService k8SHealthService )
        {
            _dbContext=dbContext;
            _redisHelper=redisHelper;
            //K8S-NOTE: comment this state for runing in local with out k8s cubeconfig 
            _k8SHealthService = k8SHealthService;
        }

        public async Task<ChallengeDeployResponeDTO> Start(ChallengeStartStopReqDTO startReq)
        {
            await Console.Out.WriteLineAsync($"Start challenge ID: {startReq.challengeId}, Team ID: {startReq.teamId}");
            var startedKey = ChallengeHelper.GetArgoWName(startReq.challengeId, startReq.teamId);
            // Get cache: thông tin deployment, kiểm tra đã từng gửi vào argo chưa
            var deploymentCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(startedKey);
            await Console.Out.WriteLineAsync($"Data from Redis for key {startedKey}: {JsonSerializer.Serialize(deploymentCache)}");

            #region Xử lý khi đã có cache deployment - đã từng gửi request deploy lên argo workflow
            if (deploymentCache != null)
            {
                switch (deploymentCache.Status)
                {
                    case DeploymentStatus.PROCESS:

                        var wfPhase = await _k8SHealthService.GetWorkflowStatus(deploymentCache.WorkFlowName);
                        // Kiểm tra trạng thái của workflow (Argo) nếu wf không ở trạng thái pending, running, succeeded thì coi như thất bại và xóa cache (startedKey)
                        if (wfPhase is not (WorkflowPhase.Pending or WorkflowPhase.Running or WorkflowPhase.Succeeded))
                        {
                            Console.WriteLine($"Workflow {deploymentCache.WorkFlowName} crashed or stopped: {wfPhase}");
                            // Xóa thông tin deployment khi bắm vào argo khi workflow chạy lỗi
                            await _redisHelper.RemoveCacheAsync(startedKey);
                            break;
                        }
                        return new ChallengeDeployResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Challenge is deploying.",
                        };
                    case DeploymentStatus.RUNING:

                        var podName = deploymentCache.NameSpace;

                        var podStatus = await _k8SHealthService.CheckPodAliveInCache(podName);
                        //var podStatus = true;
                        if (!podStatus)
                        {
                            return new ChallengeDeployResponeDTO
                            {
                                status = (int)HttpStatusCode.OK,
                                success = true,
                                message = "Challenge is deploying.",
                            };
                        }

                        int timeLeft = 0;
                        if (deploymentCache.EndTime.HasValue)
                        {
                            timeLeft  = (int)(deploymentCache.EndTime.Value - DateTime.Now).TotalMinutes;
                        }
                        return new ChallengeDeployResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Challenge is already deployed.",
                            challenge_url = deploymentCache.DeploymentDomainName,
                            time_limit = timeLeft,
                        };
                    default:
                        await Console.Out.WriteLineAsync($"Unknown deployment status: {deploymentCache.Status}");
                        break;
                }
            }
            #endregion


            var challenge = _dbContext.Challenges.FirstOrDefault(c => c.Id == startReq.challengeId);
            if (challenge == null)
                return new ChallengeDeployResponeDTO { status = (int)HttpStatusCode.NotFound, success = false, message = "Challenge not found." };

            try
            {
                #region Tạo request mới tới argo workflow
                var headers = new Dictionary<string, string> { ["Authorization"] = $"Bearer {DeploymentCenterConfigHelper.ARGO_WORKFLOWS_TOKEN}" };

                var jsonImageLink = challenge.ImageLink;
                if (jsonImageLink == null)  return new ChallengeDeployResponeDTO { status = (int)HttpStatusCode.BadRequest, success = false, message = "Challenge image link is null." };

                var imageObj = JsonSerializer.Deserialize<ChallengeImageDTO>(jsonImageLink);
                if (imageObj == null) return new ChallengeDeployResponeDTO { status = (int)HttpStatusCode.BadRequest, success = false, message = "Challenge image link is invalid." };

                var (payload, appName) = ChallengeHelper.BuildArgoPayload(
                        challenge,
                        startReq.teamId,
                        imageObj,
                        DeploymentCenterConfigHelper.CPU_LIMIT,
                        DeploymentCenterConfigHelper.CPU_REQUEST,
                        DeploymentCenterConfigHelper.MEMORY_LIMIT,
                        DeploymentCenterConfigHelper.MEMORY_REQUEST,
                        DeploymentCenterConfigHelper.POD_START_TIMEOUT_MINUTES);

                var api = DeploymentCenterConfigHelper.ARGO_WORKFLOWS_URL + "/submit";

                MultiServiceConnector multiServiceConnector = new MultiServiceConnector(api);
                var response = await multiServiceConnector.ExecuteRequest(api, Method.Post, payload, headers);

                await Console.Out.WriteLineAsync($"Response from Argo Workflows API: {response}");
                if (response == null)
                {
                    await Console.Out.WriteLineAsync("No response from Argo Workflows API");
                    return new ChallengeDeployResponeDTO { status = (int)HttpStatusCode.BadRequest, success = false, message = "No response from server" };
                }

                // lấy workflow name từ response
                string? workflowName = null;
                if (!string.IsNullOrEmpty(response))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(response);
                        workflowName = doc.RootElement
                            .GetProperty("metadata")
                            .GetProperty("name")
                            .GetString();
                    }
                    catch
                    {
                        Console.WriteLine("Unable to parse workflow name from response.");
                    }
                }

                var pods = await _redisHelper.GetFromCacheAsync<List<PodInfo>>(RedisConfigs.PodsInfoKey) ?? new List<PodInfo>();

                if (pods.FirstOrDefault(p => p.TeamId == startReq.teamId && p.ChallengeId == startReq.challengeId) is var existingPod && existingPod != null)
                {
                    existingPod.Namespace = appName;
                    existingPod.Ready = false;
                    existingPod.Status = "Pending";
                    existingPod.Age = "N/A";
                    existingPod.Name = "N/A";
                }
                else
                {
                    pods.Add(new PodInfo
                    {
                        Namespace = appName,
                        TeamId = startReq.teamId,
                        Ready = false,
                        Status = "Pending",
                        Age = "N/A",
                        Name = "N/A",
                    });
                }

                  

                ChallengeDeploymentCacheDTO chalDeploy = new ChallengeDeploymentCacheDTO
                {
                    challenge_id = startReq.challengeId,
                    user_id = startReq.userId.Value,
                    status = DeploymentStatus.PROCESS,
                    time_finished = -1
                };
                // khi nào thực sự lên thì cập nhật lại status và time_finished, challenge_url

                // Save cache: thông tin deployment khi bắm vào argo 
                await _redisHelper.SetCacheAsync(startedKey, new DeploymentInfo
                {
                    Status = DeploymentStatus.PROCESS,
                    ChallengeId = startReq.challengeId,
                    TeamId = startReq.teamId,
                    NameSpace = appName,
                    WorkFlowName = workflowName ?? string.Empty,
                });
                /*
                Save cache: thông tin tạm thông tin deployment với trạng thái processing và thời gian kết thúc -1 
                Để bên admin có thể xem được thông tin này
                */
                await _redisHelper.SetCacheAsync(ChallengeHelper.GetCacheKey(startReq.challengeId, startReq.teamId), chalDeploy, TimeSpan.FromHours(1));
                await _redisHelper.SetCacheAsync(RedisConfigs.PodsInfoKey, pods);

                //var checkCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(ChallengeHelper.GetCacheKey(startReq.challengeId, startReq.teamId));
                //await Console.Out.WriteLineAsync($"Deployment info save success: {JsonSerializer.Serialize(checkCache)}");

                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.OK,
                    success = true,
                    message = "Send to request to deploy successfully. Please wait a moment.",
                };
                #endregion
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
            await Console.Out.WriteLineAsync($"Stop challenge ID: {stopReq.challengeId}, Team ID: {stopReq.teamId}");
            try
            {
                var deployInfo = ChallengeHelper.GetCacheKey(stopReq.challengeId, stopReq.teamId);
                var argoWNameKey = ChallengeHelper.GetArgoWName(stopReq.challengeId, stopReq.teamId);
                var checkCache = await _redisHelper.GetFromCacheAsync<DeploymentInfo>(argoWNameKey);
                var pods = await _redisHelper.GetFromCacheAsync<List<PodInfo>>(RedisConfigs.PodsInfoKey);

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
                var isDelete = await _k8SHealthService.DeleteNamespace(checkCache.NameSpace);
                //var isDelete = true;
                if (isDelete)
                {
                    await _redisHelper.RemoveCacheAsync(deployInfo);
                    await _redisHelper.RemoveCacheAsync(argoWNameKey);
                    if (pods != null)
                    {
                        var podToRemove = pods.FirstOrDefault(p => p.TeamId == stopReq.teamId && p.ChallengeId == stopReq.challengeId);
                        if (podToRemove != null)
                        {
                            pods.Remove(podToRemove);
                            await _redisHelper.SetCacheAsync(RedisConfigs.PodsInfoKey, pods);
                        }
                    }
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
            //return new ChallengeDeployResponeDTO
            //{
            //    success = true,
            //    message = "Challenge status checking started",
            //    status = (int)HttpStatusCode.OK,
            //    challenge_url = "http://demo-domain-for-testing.com"
            //};
            try
            {
                var startedKey = ChallengeHelper.GetArgoWName(statusReq.challengeId, statusReq.teamId);

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

                var podName = deploymentCache.NameSpace;

                var podStatus = await _k8SHealthService.CheckPodAliveInCache(podName);

                if (podStatus)
                {
                    // Nếu pod đang chạy thì lấy thông tin domain, port ... lưu vào cache và trả về cho client 
                    var result = await _k8SHealthService.HandleChallengeRunning(statusReq.challengeId,deploymentCache.TeamId, podName,deploymentCache);
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

        public async Task<BaseResponseDTO> HandleMessageFromArgo(WorkflowStatusDTO message)
        {
            if (message.Type == Enums.ArgoMessageType.UP)
            {
                return await HandleMessageUpChallenge(message);
            }
            else if (message.Type == Enums.ArgoMessageType.START)
            {
                return await HandleMessageStartChallenge(message);
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

        private async Task<BaseResponseDTO> HandleMessageUpChallenge(WorkflowStatusDTO message)
        {
            await Console.Out.WriteLineAsync($"Message Up Challenge {JsonSerializer.Serialize(message)}");
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

                var log = await _k8SHealthService.GetWorkflowLogs(message.WorkFlowName);
                var History = new DeployHistory
                {
                    ChallengeId = message.ChallengeId.Value,
                    DeployStatus = deploystatus,
                    DeployAt = DateTime.UtcNow,
                    LogContent = log
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

        private async Task<BaseResponseDTO> HandleMessageStartChallenge(WorkflowStatusDTO message)
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

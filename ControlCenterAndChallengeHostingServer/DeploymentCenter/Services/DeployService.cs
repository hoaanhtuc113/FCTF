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
using ResourceShared.Logger;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Net;
using System.Net.WebSockets;
using System.Security.AccessControl;
using System.Text;
using System.Text.Json;
using static ResourceShared.Enums;

namespace DeploymentCenter.Services
{
    public interface IDeployService
    {
        Task<ChallengeDeployResponeDTO> Start(ChallengeStartStopReqDTO challengeStartReq);
        Task<ChallengeDeployResponeDTO> Stop(ChallengeStartStopReqDTO challengeStartReq);
        Task<BaseResponseDTO> StopAll();
        Task<ChallengeDeployResponeDTO> StatusCheck(ChallengCheckStatusReqDTO statusReq);
        Task<BaseResponseDTO> HandleMessageFromArgo(WorkflowStatusDTO message);
        Task<BaseResponseDTO<DeploymentLogsDTO>> GetDeploymentLogs(string workflowName);
        Task<BaseResponseDTO<PodLogsDTO>> GetPodLogs(ChallengeStartStopReqDTO challengeReq);
    }
    public class DeployService : IDeployService
    {
        private readonly IK8sService _k8SHealthService;
        private readonly AppDbContext _dbContext;
        private readonly RedisHelper _redisHelper;
        private readonly AppLogger _logger;
        public DeployService(AppDbContext dbContext, RedisHelper redisHelper, IK8sService k8SHealthService, AppLogger logger)
        {
            _dbContext = dbContext;
            _redisHelper = redisHelper;
            //K8S-NOTE: comment this state for runing in local with out k8s cubeconfig 
            _k8SHealthService = k8SHealthService;
            _logger = logger;
        }

        public async Task<ChallengeDeployResponeDTO> Start(ChallengeStartStopReqDTO startReq)
        {
            var deploymentKey = ChallengeHelper.GetCacheKey(startReq.challengeId, startReq.teamId);

            // Get cache: thông tin deployment, kiểm tra đã từng gửi vào argo chưa
            var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);

            #region Xử lý khi đã có cache deployment - đã từng gửi request deploy lên argo workflow
            if (deploymentCache != null)
            {
                switch (deploymentCache.status)
                {
                    case DeploymentStatus.PENDING:

                        if (!string.IsNullOrEmpty(deploymentCache.workflow_name))
                        {
                            var wfPhase = await _k8SHealthService.GetWorkflowStatus(deploymentCache.workflow_name);

                            // Kiểm tra trạng thái của workflow (Argo) nếu wf không ở trạng thái pending, running, succeeded thì coi như thất bại và xóa cache (deploymentKey)
                            if (wfPhase is not (WorkflowPhase.Pending or WorkflowPhase.Running or WorkflowPhase.Succeeded))
                            {
                                // Xóa thông tin deployment khi bắm vào argo khi workflow chạy lỗi
                                await _redisHelper.RemoveCacheAsync(deploymentKey);
                                break;
                            }
                        }

                        return new ChallengeDeployResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Challenge is deploying.",
                        };
                    case DeploymentStatus.RUNING:

                        var podName = deploymentCache._namespace;

                        //if (!string.IsNullOrEmpty(podName))
                        //{
                        //    var podStatus = await _k8SHealthService.CheckPodAliveInCache(podName);
                        //var podStatus = true;
                        if (!deploymentCache.ready)
                        {
                            return new ChallengeDeployResponeDTO
                            {
                                status = (int)HttpStatusCode.OK,
                                success = true,
                                message = "Challenge is deploying.",
                            };
                        }
                        // }

                        int timeLeft = 0;
                        if (deploymentCache.time_finished > 0)
                        {
                            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

                            long remainSec = deploymentCache.time_finished - now;
                            if (remainSec < 0) remainSec = 0;

                            timeLeft = (int)(remainSec / 60);
                        }
                        return new ChallengeDeployResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Challenge is running.",
                            challenge_url = deploymentCache.challenge_url,
                            time_limit = timeLeft,
                        };
                    default:
                        await Console.Out.WriteLineAsync($"Unknown deployment status: {deploymentCache.status}");
                        break;
                }
            }
            #endregion

            try
            {
                _dbContext.ArgoOutboxes.Add(new ArgoOutbox
                {
                    Payload = JsonSerializer.Serialize(startReq),
                    Expiry = DateTime.UtcNow.AddMinutes(5),
                });
                await _dbContext.SaveChangesAsync();

                deploymentCache = new ChallengeDeploymentCacheDTO
                {
                    challenge_id = startReq.challengeId,
                    user_id = startReq?.userId ?? 0,
                    team_id = startReq?.teamId ?? 0,
                    _namespace = string.Empty,
                    workflow_name = string.Empty,
                    status = DeploymentStatus.PENDING,
                    time_finished = 0
                };

                await _redisHelper.SetCacheAsync(deploymentKey, deploymentCache, TimeSpan.FromMinutes(5));
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.OK,
                    success = true,
                    message = "Send to request to deploy successfully. Please wait a moment.",
                };
            }
            catch (Exception ex)
            {
                await _redisHelper.RemoveCacheAsync(deploymentKey);

                _logger.LogError(ex, null, startReq.teamId, new { challengeId = startReq.challengeId });
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
            try
            {
                var deploymentKey = ChallengeHelper.GetCacheKey(stopReq.challengeId, stopReq.teamId);
                var deployInfo = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);
                //var pods = await _redisHelper.GetFromCacheAsync<List<PodInfo>>(RedisConfigs.PodsInfoKey);

                if (deploymentKey == null || deployInfo == null)
                {
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.NotFound,
                        success = false,
                        message = "No deployment cache info found for the specified challenge and team."
                    };
                }


                var user = await _dbContext.Users.FirstOrDefaultAsync(u => u.Id == stopReq.userId);

                // Admin force delete: xóa namespace và cache ngay lập tức
                if (user != null && user.Type == Enums.UserType.Admin)
                {
                    await Console.Out.WriteLineAsync($"[Admin] Force deleting namespace {deployInfo._namespace}...");
                    await _k8SHealthService.DeleteNamespace(deployInfo._namespace);

                    deployInfo.status = DeploymentStatus.STOPPED;
                    await _redisHelper.AtomicRemoveDeploymentZSet(stopReq.teamId.ToString(), deploymentKey, stopReq.challengeId.ToString());
                    await _redisHelper.RemoveCacheAsync(deploymentKey);

                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.OK,
                        success = true,
                        message = "Admin force deleted challenge successfully."
                    };
                }

                // User thường: set DELETING và để watcher xử lý
                deployInfo.status = DeploymentStatus.DELETING;
                deployInfo.ready = false;

                // Cập nhật cache với TTL dài (60s) để watcher bắt được event Terminating
                var cacheJson = System.Text.Json.JsonSerializer.Serialize(deployInfo);
                await _redisHelper.AtomicUpdateExpiration(
                    stopReq.teamId.ToString(),
                    deploymentKey,
                    stopReq.challengeId.ToString(),
                    60,  // TTL 60s đủ để pod terminate
                    cacheJson
                );


                // Delete namespace - watcher sẽ bắn STOPPED event khi nhận Terminating
                var isDelete = await _k8SHealthService.DeleteNamespace(deployInfo._namespace);

                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.OK,
                    success = true,
                    message = "Challenge is stopping, watcher will send STOPPED event when pod terminates."
                };


            }
            catch (Exception ex)
            {
                _logger.LogError(ex, null, stopReq.teamId, new { challengeId = stopReq.challengeId });
                await Console.Error.WriteLineAsync($"Error during stopping challenge: {ex.Message}");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.InternalServerError,
                    success = false,
                    message = "Error during stopping challenge."
                };
            }
        }


        public async Task<BaseResponseDTO> StopAll()
        {
            await Console.Out.WriteLineAsync("Stopping all challenges...");
            try
            {
                // Use K8s API to delete all challenge namespaces by label selector
                var (successCount, failCount, errors) = await _k8SHealthService.DeleteAllChallengeNamespaces("ctf/kind=challenge");

                // Clear all cache entries
                // Clear the entire pods list
                await _redisHelper.RemoveCacheByPattern("deploy_challenge_*");
                await _redisHelper.RemoveCacheByPattern("active_deploys_team_*");


                var message = $"Stopped {successCount} challenge namespace(s) successfully.";
                if (failCount > 0)
                {
                    message += $" {failCount} failed. Errors: {string.Join("; ", errors)}";
                }


                return new BaseResponseDTO
                {
                    Success = failCount == 0,
                    Message = message,
                    HttpStatusCode = failCount == 0 ? HttpStatusCode.OK : HttpStatusCode.PartialContent
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex);
                await Console.Error.WriteLineAsync($"Error during stopping all challenges: {ex.Message}");
                return new BaseResponseDTO
                {
                    Success = false,
                    Message = $"Error during stopping all challenges: {ex.Message}",
                    HttpStatusCode = HttpStatusCode.InternalServerError
                };
            }
        }
        public async Task<ChallengeDeployResponeDTO> StatusCheck(ChallengCheckStatusReqDTO statusReq)
        {

            try
            {
                var deploymentKey = ChallengeHelper.GetCacheKey(statusReq.challengeId, statusReq.teamId);

                var deploymentCache = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);

                if (deploymentCache == null)
                {
                    return new ChallengeDeployResponeDTO
                    {
                        success = false,
                        message = "No deployment info found.",
                        status = (int)HttpStatusCode.NotFound
                    };
                }

                var podName = deploymentCache._namespace;

                //var podStatus = await _k8SHealthService.CheckPodAliveInCache(podName);

                if (deploymentCache.status == Enums.DeploymentStatus.RUNING && deploymentCache.ready)
                {
                    // Nếu pod đang chạy thì lấy thông tin domain, port ... lưu vào cache và trả về cho client 
                    var result = await _k8SHealthService.HandleChallengeRunning(statusReq.challengeId, deploymentCache.team_id, podName, deploymentCache);
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
                _logger.LogError(ex, null, statusReq.teamId, new { challengeId = statusReq.challengeId });
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
            try
            {
                await Console.Out.WriteLineAsync($"Recieve Message From Argo: ChallengeId={message.ChallengeId}, Status={message.Status}, WorkFlowName={message.WorkFlowName}");
                var challenge = await _dbContext.Challenges.FirstOrDefaultAsync(c => c.Id == message.ChallengeId);
                if (challenge == null)
                {
                    return new BaseResponseDTO
                    {
                        Success = false,
                        Message = "Challenge not found",
                        HttpStatusCode = HttpStatusCode.NotFound
                    };
                }

                var deploystatus = Enums.GetDeploymentStatus(message.Status ?? "");

                challenge.DeployStatus = deploystatus;

                if (deploystatus == Enums.DeploymentStatus.SUCCEEDED)
                {
                    challenge.State = Enums.ChallengeState.VISIBLE;
                    deploystatus = Enums.DeploymentStatus.DEPLOY_SUCCEEDED;
                }
                else if (deploystatus == Enums.DeploymentStatus.FAILED)
                {
                    deploystatus = Enums.DeploymentStatus.DEPLOY_FAILED;
                    challenge.State = Enums.ChallengeState.HIDDEN;
                }

                //var log = await _k8SHealthService.GetWorkflowLogs(message.WorkFlowName);

                var History = new DeployHistory
                {
                    ChallengeId = message.ChallengeId.Value,
                    DeployStatus = deploystatus,
                    DeployAt = DateTime.UtcNow,
                    LogContent = message.WorkFlowName
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
                _logger.LogError(ex, data: new { message.ChallengeId, message.WorkFlowName, message.Status });
                await Console.Error.WriteLineAsync($"Recieve Message From Argo Error: {ex.Message}");
                return new BaseResponseDTO
                {
                    Success = false,
                    Message = "Internal server error",
                    HttpStatusCode = HttpStatusCode.InternalServerError
                };
            }
        }

        // Hiện tại argo chưa bắn trạng thái của workflow sau khi chạy, nên tạm thời chưa dùng đến hàm này
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
                var isRemove = await _redisHelper.RemoveCacheAsync(message.WorkFlowName);
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

        public async Task<BaseResponseDTO<DeploymentLogsDTO>> GetDeploymentLogs(string workflowName)
        {
            try
            {
                var log = await _k8SHealthService.GetWorkflowLogs(workflowName);
                if (log == null)
                {
                    return new BaseResponseDTO<DeploymentLogsDTO>
                    {
                        Success = false,
                        HttpStatusCode = HttpStatusCode.NotFound,
                        Message = "Logs not found"
                    };
                }

                return new BaseResponseDTO<DeploymentLogsDTO>
                {
                    Success = true,
                    HttpStatusCode = HttpStatusCode.OK,
                    Data = new DeploymentLogsDTO
                    {
                        WorkflowName = workflowName,
                        Logs = log
                    }
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, data: new { workflowName });
                await Console.Error.WriteLineAsync($"Error retrieving deployment logs: {ex.Message}");
                return new BaseResponseDTO<DeploymentLogsDTO>
                {
                    Success = false,
                    HttpStatusCode = HttpStatusCode.InternalServerError,
                    Message = "Error retrieving deployment logs"
                };
            }
        }

        public async Task<BaseResponseDTO<PodLogsDTO>> GetPodLogs(ChallengeStartStopReqDTO challengeReq)
        {
            try
            {
                var currentPods = await _k8SHealthService.GetPodsByLabel();
                var deployInfo = currentPods.FirstOrDefault(p => p.TeamId == challengeReq.teamId && p.ChallengeId == challengeReq.challengeId);
                if (deployInfo == null)
                {
                    return new BaseResponseDTO<PodLogsDTO>
                    {
                        Success = false,
                        HttpStatusCode = HttpStatusCode.NotFound,
                        Message = "Pod not found"
                    };
                }

                var log = await _k8SHealthService.GetPodLogs(deployInfo.Namespace, deployInfo.Name);
                return new BaseResponseDTO<PodLogsDTO>
                {
                    Success = true,
                    HttpStatusCode = HttpStatusCode.OK,
                    Data = new PodLogsDTO
                    {
                        PodName = deployInfo.Name,
                        Logs = log
                    }
                };

            }
            catch (Exception ex)
            {
                _logger.LogError(ex, null, challengeReq.teamId, new { challengeId = challengeReq.challengeId });
                await Console.Error.WriteLineAsync($"Error retrieving pod logs: {ex.Message}");
                return new BaseResponseDTO<PodLogsDTO>
                {
                    Success = false,
                    HttpStatusCode = HttpStatusCode.InternalServerError,
                    Message = "Error retrieving pod logs"
                };
            }
        }
    }
}

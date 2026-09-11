using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ResourceShared;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Services;
using ResourceShared.Utils;
using RabbitMQ.Client.Exceptions;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using static ResourceShared.Enums;
using DeploymentCenter.Utils;

namespace DeploymentCenter.Services;

public interface IDeployService
{
    Task<ChallengeDeployResponeDTO> Start(ChallengeStartStopReqDTO challengeStartReq);
    Task<ChallengeDeployResponeDTO> Stop(ChallengeStartStopReqDTO challengeStartReq);
    Task<BaseResponseDTO> StopAll(int contestId, int? userId);
    Task<BaseResponseDTO> StopAllGlobal(int? userId);
    Task<ChallengeDeployResponeDTO> StatusCheck(ChallengCheckStatusReqDTO statusReq);
    Task<BaseResponseDTO> HandleMessageFromArgo(WorkflowStatusDTO message);
    Task<BaseResponseDTO<DeploymentLogsDTO>> GetDeploymentLogs(string workflowName);
    Task<BaseResponseDTO<PodLogsDTO>> GetPodLogs(ChallengeStartStopReqDTO challengeReq);
    Task<BaseResponseDTO<InstanceRequestLogsDTO>> GetInstanceRequestLogs(InstanceRequestLogsReqDTO request);
}
public class DeployService : IDeployService
{
    private const int MaxLokiResponseBytes = 2 * 1024 * 1024;
    private readonly IK8sService _k8SHealthService;
    private readonly AppDbContext _dbContext;
    private readonly RedisHelper _redisHelper;
    private readonly AppLogger _logger;
    private readonly IDeploymentProducerService _deploymentProducerService;
    public DeployService(
        AppDbContext dbContext,
        RedisHelper redisHelper,
        IK8sService k8SHealthService,
        AppLogger logger,
        IDeploymentProducerService deploymentProducerService)
    {
        _dbContext = dbContext;
        _redisHelper = redisHelper;
        //K8S-NOTE: comment this state for runing in local with out k8s cubeconfig 
        _k8SHealthService = k8SHealthService;
        _logger = logger;
        _deploymentProducerService = deploymentProducerService;
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
                        message = "Your challenge is being prepared. This usually takes a few moments.",
                    };
                case DeploymentStatus.RUNING:

                    var podName = deploymentCache._namespace;

                    if (!deploymentCache.ready)
                    {
                        return new ChallengeDeployResponeDTO
                        {
                            status = (int)HttpStatusCode.OK,
                            success = true,
                            message = "Your challenge is starting. Please wait while we finish setup.",
                        };
                    }

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
                        message = "Your challenge is ready.",
                        challenge_url = deploymentCache.challenge_url,
                        time_limit = timeLeft,
                    };
                case DeploymentStatus.DELETING:
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.Conflict,
                        success = false,
                        message = "A previous session is being stopped. Please try again in a few seconds.",
                    };
                case DeploymentStatus.STOPPED:
                    // Clean up old STOPPED cache and allow new deployment
                    await Console.Out.WriteLineAsync($"Removing STOPPED cache for {deploymentKey} before new deployment");
                    await _redisHelper.RemoveCacheAsync(deploymentKey);
                    await _redisHelper.AtomicRemoveDeploymentZSet(startReq.teamId.ToString(), deploymentKey, startReq.challengeId.ToString());
                    break;
                default:
                    await Console.Out.WriteLineAsync($"Unknown deployment status: {deploymentCache.status}");
                    break;
            }
        }
        #endregion

        try
        {
            var expirySeconds = DeploymentCenterConfigHelper.DEPLOYMENT_QUEUE_TIMEOUT_MINUTES * 60;

            // Which contest this deploy belongs to decides how much of the shared
            // queue it may take, so it is read from the challenge row rather than
            // from the request - a caller that picks its own contest picks its own
            // quota. deployment_center already holds SELECT on challenges.
            var challengeContext = await _dbContext.Challenges
                .AsNoTracking()
                .Where(c => c.Id == startReq.challengeId)
                .Select(c => new
                {
                    c.ContestId,
                    c.Name,
                    ContestName = c.Contest.Name,
                    c.TimeLimit,
                })
                .FirstOrDefaultAsync();

            if (challengeContext == null)
            {
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.NotFound,
                    success = false,
                    message = "Challenge not found."
                };
            }

            var contestId = challengeContext.ContestId;
            // The contest boundary is resolved from the challenge row, never
            // trusted from an external start request.
            startReq.contestId = contestId;

            // Both limits below are enforced on start rather than on stop, although the
            // loop they bound is start/stop/start. Stopping is one API call; starting is
            // an Argo workflow, a namespace and everything the workflow touches. Throttling
            // the stop would only keep those alive longer, which is the opposite of what
            // the pressure calls for.
            var nowSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var cooldownKey = $"deploy_cooldown_{startReq.challengeId}_{startReq.teamId}";

            var cooldownRemaining = await _redisHelper.GetDeployCooldownRemaining(cooldownKey, nowSeconds);
            if (cooldownRemaining > 0)
            {
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.TooManyRequests,
                    success = false,
                    message = $"This challenge was stopped moments ago. Please wait {cooldownRemaining}s before starting it again."
                };
            }

            // Unique per attempt, not per challenge: a member that repeats is read as a
            // slot the team already holds and the start goes uncounted - which is exactly
            // the repeated start this is here to count.
            var startAttemptMember = $"{deploymentKey}:{Guid.NewGuid():N}";

            var startSlotReserved = await _redisHelper.AtomicTryReserveStartSlot(
                startReq.teamId.ToString(),
                startAttemptMember,
                DeploymentCenterConfigHelper.MAX_STARTS_PER_TEAM,
                DeploymentCenterConfigHelper.START_WINDOW_MINUTES * 60);

            if (!startSlotReserved)
            {
                _logger.Log(
                    "DEPLOY_START_RATE_LIMITED",
                    startReq.userId,
                    startReq.teamId,
                    new { startReq.challengeId },
                    LogLevel.Warning,
                    contestId: contestId);

                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.TooManyRequests,
                    success = false,
                    message = $"Your team has started too many challenges in the last {DeploymentCenterConfigHelper.START_WINDOW_MINUTES} minutes. Please wait before starting another."
                };
            }

            var slotReserved = await _redisHelper.AtomicTryReserveContestSlot(
                contestId.ToString(),
                deploymentKey,
                DeploymentCenterConfigHelper.MAX_QUEUED_PER_CONTEST,
                expirySeconds);

            if (!slotReserved)
            {
                // Refused before publishing, so the queue keeps room for the other
                // contests. Without this the broker refuses whoever publishes next,
                // which is not the same thing: the contest that filled the queue is
                // rarely the one that gets turned away.
                await _redisHelper.RemoveCacheAsync(deploymentKey);

                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.TooManyRequests,
                    success = false,
                    message = "This contest has too many deployments queued. Please retry in a moment."
                };
            }

            var instanceResult = await CreateChallengeInstanceAsync(
                startReq,
                contestId,
                challengeContext.Name ?? string.Empty,
                challengeContext.ContestName ?? string.Empty,
                challengeContext.TimeLimit);
            var instance = instanceResult.Instance;
            if (!instanceResult.Created)
            {
                await _redisHelper.AtomicRemoveDeploymentZSet(startReq.teamId.ToString(), deploymentKey, startReq.challengeId.ToString());
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.OK,
                    success = true,
                    message = "Your existing challenge instance is still being prepared or running.",
                    instance_id = instance.InstanceId,
                };
            }
            startReq.instanceId = instance.InstanceId;
            startReq.provisionRequestId = instance.ProvisionRequestId;
            startReq.instanceNamespace = instance.Namespace;

            await _deploymentProducerService.EnqueueDeploymentAsync(startReq, expirySeconds);

            deploymentCache = new ChallengeDeploymentCacheDTO
            {
                challenge_id = startReq.challengeId,
                user_id = startReq?.userId ?? 0,
                team_id = startReq?.teamId ?? 0,
                contest_id = contestId,
                instance_id = instance.InstanceId,
                provision_request_id = instance.ProvisionRequestId,
                _namespace = instance.Namespace,
                workflow_name = string.Empty,
                status = DeploymentStatus.PENDING_DEPLOY,
                time_finished = 0
            };

            var teamIdStr = startReq?.teamId.ToString() ?? "0";
            var challengeIdStr = startReq?.challengeId.ToString() ?? "0";

            var updated = await _redisHelper.AtomicUpdateExpiration(
                teamIdStr,
                deploymentKey,
                challengeIdStr,
                expirySeconds,
                JsonSerializer.Serialize(deploymentCache));

            if (!updated)
            {
                await _redisHelper.RemoveCacheAsync(deploymentKey);
                await MarkInstanceFailedAsync(startReq.instanceId, "cache_write_failed");
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.Conflict,
                    success = false,
                    message = "Deployment reservation expired. Please try again."
                };
            }
            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.OK,
                success = true,
                message = "Request received. Your challenge has been queued for deployment.",
                instance_id = instance.InstanceId,
            };
        }
        catch (BrokerUnreachableException ex)
        {
            await _redisHelper.RemoveCacheAsync(deploymentKey);
            await MarkInstanceFailedAsync(startReq.instanceId, "queue_unavailable");

            _logger.LogError(ex, null, startReq.teamId, new { startReq.challengeId }, contestId: startReq.contestId);
            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.InternalServerError,
                success = false,
                message = "Deployment service is temporarily unavailable. Please try again shortly."
            };
        }
        catch (DeploymentQueueFullException ex)
        {
            await _redisHelper.RemoveCacheAsync(deploymentKey);
            await MarkInstanceFailedAsync(startReq.instanceId, "queue_full");

            _logger.LogError(ex, null, startReq.teamId, new { startReq.challengeId }, contestId: startReq.contestId);
            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.TooManyRequests,
                success = false,
                message = "Deployment queue is currently full. Please retry in a moment."
            };
        }
        catch (DeploymentRoutingFailedException ex)
        {
            await _redisHelper.RemoveCacheAsync(deploymentKey);
            await MarkInstanceFailedAsync(startReq.instanceId, "queue_routing_failed");

            _logger.LogError(ex, null, startReq.teamId, new { startReq.challengeId }, contestId: startReq.contestId);
            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.InternalServerError,
                success = false,
                message = "Deployment routing failed. Please contact support if this persists."
            };
        }
        catch (Exception ex)
        {
            await _redisHelper.RemoveCacheAsync(deploymentKey);
            await MarkInstanceFailedAsync(startReq.instanceId, "start_failed");

            _logger.LogError(ex, null, startReq.teamId, new { startReq.challengeId }, contestId: startReq.contestId);

            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.InternalServerError,
                success = false,
                message = "Something went wrong while starting the challenge. Please try again."
            };
        }
    }

    private async Task<(ChallengeInstance Instance, bool Created)> CreateChallengeInstanceAsync(
        ChallengeStartStopReqDTO request,
        int contestId,
        string challengeName,
        string contestName,
        int? timeLimitMinutes)
    {
        var scope = request.teamId == -2 ? "shared" : "team";
        int? ownerTeamId = scope == "team" && request.teamId > 0 ? request.teamId : null;

        // If Redis lost a cache entry after the request was accepted, preserve
        // the native instance rather than starting another deployment for the
        // same active team/shared scope.
        var existing = await _dbContext.ChallengeInstances
            .Where(i => i.ContestId == contestId
                && i.ChallengeId == request.challengeId
                && i.InstanceScope == scope
                && i.InstanceOwnerTeamId == ownerTeamId
                && (i.LifecycleState == "provisioning" || i.LifecycleState == "running" || i.LifecycleState == "stopping"))
            .OrderByDescending(i => i.RequestedAt)
            .FirstOrDefaultAsync();
        if (existing != null)
        {
            return (existing, false);
        }

        var ownerTeamName = ownerTeamId.HasValue
            ? await _dbContext.Teams.AsNoTracking()
                .Where(team => team.Id == ownerTeamId.Value)
                .Select(team => team.Name)
                .FirstOrDefaultAsync()
            : null;

        var now = DateTime.UtcNow;
        var instanceId = Guid.NewGuid().ToString();
        var instance = new ChallengeInstance
        {
            InstanceId = instanceId,
            ProvisionRequestId = Guid.NewGuid().ToString(),
            ContestId = contestId,
            ChallengeId = request.challengeId,
            ContestNameSnapshot = contestName ?? string.Empty,
            ChallengeNameSnapshot = challengeName,
            Namespace = ChallengeHelper.GetDeploymentAppName(request.teamId, contestId, challengeName, instanceId),
            InstanceScope = scope,
            InstanceOwnerTeamId = ownerTeamId,
            OwnerTeamNameSnapshot = ownerTeamName,
            StartedByUserId = request.userId,
            RequestedAt = now,
            ExpiresAt = timeLimitMinutes is > 0 ? now.AddMinutes(timeLimitMinutes.Value) : null,
            LifecycleState = "provisioning",
            IdentitySource = "native",
            StateVersion = 0,
            StateChangedAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };

        await _dbContext.ChallengeInstances.AddAsync(instance);
        await _dbContext.SaveChangesAsync();
        return (instance, true);
    }

    private async Task MarkInstanceFailedAsync(string? instanceId, string reason)
    {
        if (string.IsNullOrWhiteSpace(instanceId))
        {
            return;
        }

        var instance = await _dbContext.ChallengeInstances.FirstOrDefaultAsync(i => i.InstanceId == instanceId);
        if (instance == null || instance.LifecycleState is "running" or "stopping" or "stopped" or "failed")
        {
            return;
        }

        var now = DateTime.UtcNow;
        instance.LifecycleState = "failed";
        instance.TerminalReason = reason;
        instance.StoppedAt = now;
        instance.StateChangedAt = now;
        instance.UpdatedAt = now;
        instance.StateVersion++;
        await _dbContext.SaveChangesAsync();
    }

    private async Task TransitionInstanceAsync(string? instanceId, string state, string? terminalReason = null)
    {
        if (string.IsNullOrWhiteSpace(instanceId)) return;
        var instance = await _dbContext.ChallengeInstances.FirstOrDefaultAsync(i => i.InstanceId == instanceId);
        if (instance == null || instance.LifecycleState is "stopped" or "failed") return;
        var now = DateTime.UtcNow;
        instance.LifecycleState = state;
        if (state == "stopped") instance.StoppedAt ??= now;
        if (!string.IsNullOrWhiteSpace(terminalReason)) instance.TerminalReason = terminalReason;
        instance.StateChangedAt = now;
        instance.UpdatedAt = now;
        instance.StateVersion++;
        await _dbContext.SaveChangesAsync();
    }

    public async Task<ChallengeDeployResponeDTO> Stop(ChallengeStartStopReqDTO stopReq)
    {
        try
        {
            var deploymentKey = ChallengeHelper.GetCacheKey(stopReq.challengeId, stopReq.teamId);
            var deployInfo = await _redisHelper.GetFromCacheAsync<ChallengeDeploymentCacheDTO>(deploymentKey);

            if (deploymentKey == null || deployInfo == null)
            {
                return new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.NotFound,
                    success = false,
                    message = "No deployment cache info found for the specified challenge and team."
                };
            }

            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == stopReq.userId);

            // Admin force delete: xóa namespace và cache ngay lập tức
            if (user != null && user.Type == UserType.Admin)
            {
                _logger.LogAudit(
                    "admin_force_delete_namespace",
                    before: new { @namespace = deployInfo._namespace, stopReq.challengeId, stopReq.teamId },
                    userId: user.Id,
                    contestId: stopReq.contestId,
                    teamId: stopReq.teamId);

                var namespaceDeleted = await _k8SHealthService.DeleteNamespace(deployInfo._namespace ?? string.Empty);

                // DeleteNamespace swallows its own exceptions and returns false on
                // failure instead of throwing - so this branch used to fall straight
                // through to clearing Redis/the ZSET slot and reporting success even
                // when the K8s call never went through. That leaves the pod orphaned
                // (still running, no tracking record, no automatic retry anywhere)
                // while the admin is told the force-delete worked. Bail out here
                // instead, leaving the deployment cache untouched so the admin can see
                // it is still live and retry.
                if (!namespaceDeleted)
                {
                    return new ChallengeDeployResponeDTO
                    {
                        status = (int)HttpStatusCode.InternalServerError,
                        success = false,
                        message = "Failed to delete the challenge namespace. The deployment is still tracked as running; please retry."
                    };
                }

                deployInfo.status = DeploymentStatus.STOPPED;
                await TransitionInstanceAsync(deployInfo.instance_id, "stopped", "admin_force_delete");
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
            await TransitionInstanceAsync(deployInfo.instance_id, "stopping");

            // Cập nhật cache với TTL dài (60s) để watcher bắt được event Terminating
            var cacheJson = System.Text.Json.JsonSerializer.Serialize(deployInfo);
            await _redisHelper.AtomicUpdateExpiration(
                stopReq.teamId.ToString(),
                deploymentKey,
                stopReq.challengeId.ToString(),
                40,  // TTL 40s đủ để pod terminate
                cacheJson
            );


            // Delete namespace - watcher sẽ bắn STOPPED event khi nhận Terminating
            var isDelete = await _k8SHealthService.DeleteNamespace(deployInfo._namespace);

            // Đặt sau khi đã thực sự xoá namespace, và chỉ trên nhánh của user thường:
            // nhánh admin ở trên là hành động của người khác, không phải của team, nên
            // không có lý do gì phạt team bằng một khoảng chờ.
            //
            // Lỗi ở đây chỉ ghi lại rồi đi tiếp. Namespace đã mất, báo stop thất bại vì
            // không ghi nổi một cái khoá chờ là báo sai thứ quan trọng hơn.
            try
            {
                await _redisHelper.SetDeployCooldown(
                    $"deploy_cooldown_{stopReq.challengeId}_{stopReq.teamId}",
                    DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    DeploymentCenterConfigHelper.DEPLOY_COOLDOWN_SECONDS);
            }
            catch (Exception ex)
            {
                await Console.Error.WriteLineAsync($"[Cooldown] Failed to set start cooldown for challenge {stopReq.challengeId}, team {stopReq.teamId}: {ex.Message}");
            }

            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.OK,
                success = true,
                message = "Challenge is stopping, watcher will send STOPPED event when pod terminates."
            };


        }
        catch (Exception ex)
        {
            _logger.LogError(ex, null, stopReq.teamId, new { challengeId = stopReq.challengeId }, contestId: stopReq.contestId);
            await Console.Error.WriteLineAsync($"Error during stopping challenge: {ex.Message}");
            return new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.InternalServerError,
                success = false,
                message = "Error during stopping challenge."
            };
        }
    }


    public async Task<BaseResponseDTO> StopAll(int contestId, int? userId)
    {
        if (contestId <= 0)
        {
            return new BaseResponseDTO
            {
                Success = false,
                Message = "contestId is required. Use StopAllGlobal to stop every contest's challenges.",
                HttpStatusCode = HttpStatusCode.BadRequest
            };
        }

        await Console.Out.WriteLineAsync($"Stopping all challenges for contest {contestId}...");
        try
        {
            var ids = await _dbContext.Challenges
                .Where(c => c.ContestId == contestId)
                .Select(c => c.Id)
                .ToListAsync();

            if (ids.Count == 0)
            {
                return new BaseResponseDTO
                {
                    Success = true,
                    Message = $"No challenges found for contest {contestId}.",
                    HttpStatusCode = HttpStatusCode.OK
                };
            }

            // Recorded before the deletion, not after: this tears down every
            // running instance for every team in the contest, and an audit
            // trail that only exists when the operation finishes cleanly is not
            // one. Console.Out goes to a container log that rotates away; this
            // goes to the same action log as the rest of the admin actions.
            var challengeIdFilter = new HashSet<int>(ids);
            _logger.Log(
                "stop_all_contest",
                userId,
                null,
                new { contestId, challengeCount = challengeIdFilter.Count },
                level: LogLevel.Warning,
                contestId: contestId);

            var (successCount, failCount, errors) = await _k8SHealthService.DeleteAllChallengeNamespaces("ctf/kind=challenge", challengeIdFilter);

            // Clears the ZSET entries as well as the JSON keys. Dropping only
            // the keys left every affected team holding slots against its
            // concurrent-deployment limit for challenges that no longer exist.
            foreach (var cid in challengeIdFilter)
                await _redisHelper.RemoveDeploymentsForChallenge(cid);

            var message = $"Stopped {successCount} challenge namespace(s) for contest {contestId} successfully.";
            if (failCount > 0)
            {
                message += $" {failCount} failed. Errors: {string.Join("; ", errors)}";
                await Console.Error.WriteLineAsync(
                    $"[WARNING] StopAll partial failure for contest {contestId}: {failCount} namespace(s) could not be deleted after retries. " +
                    $"Retry the stop-all operation or delete manually. Errors: {string.Join("; ", errors)}");
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
            _logger.LogError(ex, contestId: contestId);
            await Console.Error.WriteLineAsync($"Error during stopping all challenges: {ex.Message}");
            return new BaseResponseDTO
            {
                Success = false,
                Message = $"Error during stopping all challenges: {ex.Message}",
                HttpStatusCode = HttpStatusCode.InternalServerError
            };
        }
    }

    // Deletes every ctf/kind=challenge namespace across every contest - no
    // contestId filter. Kept as a distinct method (rather than StopAll's old
    // contestId=0 fallback) so it can only be reached through the separate,
    // extra-confirmation-gated /stop-all-global endpoint.
    public async Task<BaseResponseDTO> StopAllGlobal(int? userId)
    {
        await Console.Out.WriteLineAsync("Stopping ALL challenges across ALL contests...");

        // Stopping every contest at once is expected/low-risk when there's
        // only ever one contest live. With 2+ running concurrently it means
        // an admin just took down someone else's contest too - that's the
        // scenario worth paging someone over, not just an info log line.
        var now = DateTime.UtcNow;
        var runningContestIds = await _dbContext.Contests
            .AsNoTracking()
            .Where(c => c.State != "paused" && c.State != "ended"
                && (c.StartTime == null || now >= c.StartTime)
                && (c.EndTime == null || now <= c.EndTime))
            .Select(c => c.Id)
            .ToListAsync();

        if (runningContestIds.Count >= 2)
        {
            _logger.Log(
                "stop_all_global_multi_contest",
                userId,
                null,
                new { runningContestCount = runningContestIds.Count, runningContestIds },
                level: LogLevel.Critical);
        }

        try
        {
            var (successCount, failCount, errors) = await _k8SHealthService.DeleteAllChallengeNamespaces("ctf/kind=challenge", null);

            await _redisHelper.RemoveCacheByPattern("deploy_challenge_*");
            await _redisHelper.RemoveCacheByPattern("active_deploys_team_*");

            var message = $"Stopped {successCount} challenge namespace(s) across all contests successfully.";
            if (failCount > 0)
            {
                message += $" {failCount} failed. Errors: {string.Join("; ", errors)}";
                await Console.Error.WriteLineAsync(
                    $"[WARNING] StopAllGlobal partial failure: {failCount} namespace(s) could not be deleted after retries. " +
                    $"Retry the stop-all operation or delete manually. Errors: {string.Join("; ", errors)}");
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

            if (deploymentCache.status == DeploymentStatus.RUNING && deploymentCache.ready)
            {
                // Nếu pod đang chạy thì lấy thông tin domain, port ... lưu vào cache và trả về cho client 
                var result = await _k8SHealthService.HandleChallengeRunning(
                    statusReq.challengeId,
                    deploymentCache.team_id,
                    podName,
                    deploymentCache);
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
            _logger.LogError(ex, null, statusReq.teamId, new { statusReq.challengeId });
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

            // The signature on this callback proves it was made with the shared
            // key; it does not prove which challenge the sender was building.
            // Nothing else here is contest-scoped, so without the check below a
            // single valid callback could publish or hide any challenge in the
            // cluster just by naming its id. Which challenge may be written is
            // therefore taken from the workflow named in the message, not from
            // the message, and the two have to agree.
            if (string.IsNullOrWhiteSpace(message.WorkFlowName) || !message.ChallengeId.HasValue)
            {
                return new BaseResponseDTO
                {
                    Success = false,
                    Message = "WorkFlowName and ChallengeId are required",
                    HttpStatusCode = HttpStatusCode.BadRequest
                };
            }

            var (workflowFound, workflowChallengeId) = await _k8SHealthService.GetWorkflowChallengeId(message.WorkFlowName);

            if (!workflowFound || workflowChallengeId == null)
            {
                _logger.Log(
                    "ARGO_CALLBACK_UNKNOWN_WORKFLOW",
                    null,
                    null,
                    new { message.WorkFlowName, message.ChallengeId, workflowFound },
                    LogLevel.Warning);

                return new BaseResponseDTO
                {
                    Success = false,
                    Message = "Unknown workflow",
                    HttpStatusCode = HttpStatusCode.NotFound
                };
            }

            if (workflowChallengeId.Value != message.ChallengeId.Value)
            {
                // Someone signed a callback for a challenge the named workflow
                // never built. That is not a mistake a caller makes by accident,
                // so it is logged loudly rather than just refused.
                _logger.Log(
                    "ARGO_CALLBACK_CHALLENGE_MISMATCH",
                    null,
                    null,
                    new { message.WorkFlowName, claimedChallengeId = message.ChallengeId, workflowChallengeId },
                    LogLevel.Critical);

                return new BaseResponseDTO
                {
                    Success = false,
                    Message = "Challenge does not match the workflow",
                    HttpStatusCode = HttpStatusCode.Forbidden
                };
            }

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

            // GetDeploymentStatus already translates the Argo phase, so the checks
            // below compare against what it returns. They used to compare the
            // translated value against the raw phase constants ("Succeeded" /
            // "Failed"), which never matched - challenge.State was left untouched
            // and a challenge that built fine never became visible on its own.
            var deploystatus = Enums.GetDeploymentStatus(message.Status ?? "");

            challenge.DeployStatus = deploystatus;

            if (deploystatus == Enums.DeploymentStatus.DEPLOY_SUCCESS)
            {
                challenge.State = Enums.ChallengeState.VISIBLE;
            }
            else if (deploystatus == Enums.DeploymentStatus.DEPLOY_FAILED)
            {
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
        var checkedAt = DateTimeOffset.UtcNow;
        try
        {
            var deployInfo = await _k8SHealthService.GetChallengePod(
                challengeReq.challengeId,
                challengeReq.teamId);
            if (deployInfo == null)
            {
                return new BaseResponseDTO<PodLogsDTO>
                {
                    Success = false,
                    HttpStatusCode = HttpStatusCode.NotFound,
                    Message = "Pod not found",
                    Data = CreatePodLogsResponse(challengeReq, checkedAt, "NOT_FOUND"),
                };
            }

            var podState = deployInfo.IsTerminated
                ? "TERMINATED"
                : deployInfo.Ready ? "READY" : "NOT_READY";
            var responseData = CreatePodLogsResponse(challengeReq, checkedAt, podState, deployInfo);
            var log = await _k8SHealthService.GetPodLogs(deployInfo.Namespace, deployInfo.Name);
            if (!log.Success)
            {
                responseData.LogState = "READ_FAILED";
                responseData.LogReason = log.SafeReason;
                return new BaseResponseDTO<PodLogsDTO>
                {
                    Success = false,
                    HttpStatusCode = HttpStatusCode.BadGateway,
                    Message = "Pod logs could not be read.",
                    Data = responseData,
                };
            }

            responseData.Logs = log.Logs;
            responseData.LogState = string.IsNullOrWhiteSpace(log.Logs) ? "EMPTY" : "AVAILABLE";
            return new BaseResponseDTO<PodLogsDTO>
            {
                Success = true,
                HttpStatusCode = HttpStatusCode.OK,
                Data = responseData,
            };

        }
        catch (Exception ex)
        {
            _logger.LogError(ex, null, challengeReq.teamId, new { challengeId = challengeReq.challengeId }, contestId: challengeReq.contestId);
            return new BaseResponseDTO<PodLogsDTO>
            {
                Success = false,
                HttpStatusCode = HttpStatusCode.ServiceUnavailable,
                Message = "Live Pod Logs is temporarily unavailable.",
                Data = new PodLogsDTO
                {
                    TeamId = challengeReq.teamId,
                    ChallengeId = challengeReq.challengeId,
                    SourceState = "UNAVAILABLE",
                    PodState = "UNKNOWN",
                    LogState = "NOT_REQUESTED",
                    CheckedAt = checkedAt,
                }
            };
        }
    }

    private static PodLogsDTO CreatePodLogsResponse(
        ChallengeStartStopReqDTO request,
        DateTimeOffset checkedAt,
        string podState,
        PodInfo? pod = null)
    {
        return new PodLogsDTO
        {
            TeamId = request.teamId,
            ChallengeId = request.challengeId,
            SourceState = "AVAILABLE",
            PodState = podState,
            LogState = "NOT_REQUESTED",
            PodName = pod?.Name ?? string.Empty,
            Namespace = pod?.Namespace ?? string.Empty,
            PodPhase = pod?.Phase ?? "Unknown",
            Ready = pod?.Ready,
            Reason = pod?.Reason,
            CheckedAt = checkedAt,
        };
    }

    public async Task<BaseResponseDTO<InstanceRequestLogsDTO>> GetInstanceRequestLogs(InstanceRequestLogsReqDTO request)
    {
        if (request == null || !Guid.TryParse(request.InstanceId, out var parsedInstanceId))
        {
            return new BaseResponseDTO<InstanceRequestLogsDTO>
            {
                Success = false,
                HttpStatusCode = HttpStatusCode.BadRequest,
                Message = "instanceId must be a UUID."
            };
        }

        var limit = request.Limit <= 0 ? 50 : Math.Min(request.Limit, 100);
        var now = DateTimeOffset.UtcNow;
        var from = request.Filters?.From ?? now.AddHours(-24);
        var to = request.Filters?.To ?? now;
        if (from > to || to - from > TimeSpan.FromHours(24))
        {
            return new BaseResponseDTO<InstanceRequestLogsDTO>
            {
                Success = false,
                HttpStatusCode = HttpStatusCode.BadRequest,
                Message = "The requested time range must be ordered and at most 24 hours."
            };
        }

        // from/to default to a rolling window. Binding those implicit values to
        // a cursor would make a perfectly valid "load older" request fail a few
        // milliseconds later; explicit event filters remain bound instead.
        var filterHash = BuildFilterHash(request.Filters);
        CursorState? cursor = null;
        if (!string.IsNullOrWhiteSpace(request.Cursor)
            && !TryReadCursor(request.Cursor, parsedInstanceId.ToString(), filterHash, out cursor))
        {
            return new BaseResponseDTO<InstanceRequestLogsDTO>
            {
                Success = false,
                HttpStatusCode = HttpStatusCode.BadRequest,
                Message = "The request-log cursor is invalid or expired."
            };
        }

        var instance = await _dbContext.ChallengeInstances
            .AsNoTracking()
            .Include(i => i.Pods)
            .FirstOrDefaultAsync(i => i.InstanceId == parsedInstanceId.ToString());
        if (instance == null)
        {
            return new BaseResponseDTO<InstanceRequestLogsDTO>
            {
                Success = false,
                HttpStatusCode = HttpStatusCode.NotFound,
                Message = "Challenge instance was not found."
            };
        }

        var result = new InstanceRequestLogsDTO
        {
            Instance = new InstanceSummaryDTO
            {
                InstanceId = instance.InstanceId,
                ContestId = instance.ContestId,
                ChallengeId = instance.ChallengeId,
                ContestName = instance.ContestNameSnapshot,
                ChallengeName = instance.ChallengeNameSnapshot,
                Namespace = instance.Namespace,
                Scope = instance.InstanceScope,
                OwnerTeamId = instance.InstanceOwnerTeamId,
                OwnerTeamName = instance.OwnerTeamNameSnapshot,
                LifecycleState = instance.LifecycleState,
                IdentitySource = instance.IdentitySource,
                RequestedAt = instance.RequestedAt,
                RunningAt = instance.RunningAt,
                StoppedAt = instance.StoppedAt,
                ExpiresAt = instance.ExpiresAt,
            },
            PodHistory = instance.Pods
                .OrderByDescending(p => p.LastObservedAt)
                .Select(p => new InstancePodHistoryDTO
                {
                    PodUid = p.PodUid,
                    PodName = p.PodName,
                    FirstObservedAt = p.FirstObservedAt,
                    LastObservedAt = p.LastObservedAt,
                    TerminatedAt = p.TerminatedAt,
                    TerminationReason = p.TerminationReason,
                }).ToList(),
        };

        try
        {
            var selector = "{app=\"challenge-gateway\",contest_id=\"" + instance.ContestId + "\"}";
            var logql = selector + " | json | instance_id=\"" + instance.InstanceId + "\"";
            var startNs = from.ToUnixTimeMilliseconds() * 1_000_000;
            var endNs = to.ToUnixTimeMilliseconds() * 1_000_000;
            var baseUrl = (DeploymentCenterConfigHelper.LOKI_BASE_URL ?? "http://loki-stack:3100").Trim();
            using var client = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(15) };
            var url = "/loki/api/v1/query_range?query=" + Uri.EscapeDataString(logql)
                + "&start=" + startNs + "&end=" + endNs + "&limit=2000&direction=backward";
            using var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode)
            {
                _logger.Log("instance_request_logs_unavailable", null, null,
                    new { instanceId = instance.InstanceId, status = (int)response.StatusCode },
                    level: LogLevel.Warning, contestId: instance.ContestId);
                result.SourceStatus = "unavailable";
                return new BaseResponseDTO<InstanceRequestLogsDTO>
                {
                    Success = false,
                    HttpStatusCode = HttpStatusCode.ServiceUnavailable,
                    Message = "Request telemetry is temporarily unavailable.",
                    Data = result
                };
            }

            using var document = JsonDocument.Parse(await ReadLokiResponseAsync(response.Content));
            var allEvents = ReadGatewayEvents(document.RootElement, instance.InstanceId)
                .Where(e => EventMatches(e, request.Filters))
                .OrderByDescending(e => e.OccurredAt)
                .ThenByDescending(e => e.EventId, StringComparer.Ordinal)
                .ToList();

            var unique = new Dictionary<string, GatewayAccessEventDTO>(StringComparer.Ordinal);
            foreach (var item in allEvents)
            {
                if (unique.TryGetValue(item.EventId, out var prior)
                    && JsonSerializer.Serialize(prior) != JsonSerializer.Serialize(item))
                {
                    return new BaseResponseDTO<InstanceRequestLogsDTO>
                    {
                        Success = false,
                        HttpStatusCode = HttpStatusCode.Conflict,
                        Message = "Telemetry event identity collision detected."
                    };
                }
                unique[item.EventId] = item;
            }

            var ordered = unique.Values
                .OrderByDescending(e => e.OccurredAt)
                .ThenByDescending(e => e.EventId, StringComparer.Ordinal)
                .Where(e => cursor == null || e.OccurredAt < cursor.OccurredAt
                    || (e.OccurredAt == cursor.OccurredAt && string.CompareOrdinal(e.EventId, cursor.EventId) < 0))
                .ToList();
            result.Events = ordered.Take(limit).ToList();
            if (ordered.Count > result.Events.Count && result.Events.Count > 0)
            {
                var last = result.Events[^1];
                result.NextCursor = CreateCursor(instance.InstanceId, filterHash, last.OccurredAt, last.EventId);
            }

            return new BaseResponseDTO<InstanceRequestLogsDTO>
            {
                Success = true,
                HttpStatusCode = HttpStatusCode.OK,
                Data = result
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, null, null, new { instanceId = instance.InstanceId }, contestId: instance.ContestId);
            result.SourceStatus = "unavailable";
            return new BaseResponseDTO<InstanceRequestLogsDTO>
            {
                Success = false,
                HttpStatusCode = HttpStatusCode.ServiceUnavailable,
                Message = "Request telemetry is temporarily unavailable.",
                Data = result
            };
        }
    }

    private static IEnumerable<GatewayAccessEventDTO> ReadGatewayEvents(JsonElement root, string instanceId)
    {
        if (!root.TryGetProperty("data", out var data) || !data.TryGetProperty("result", out var streams)
            || streams.ValueKind != JsonValueKind.Array)
            yield break;

        foreach (var stream in streams.EnumerateArray())
        {
            if (!stream.TryGetProperty("values", out var values) || values.ValueKind != JsonValueKind.Array)
                continue;
            foreach (var value in values.EnumerateArray())
            {
                if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() < 2)
                    continue;
                var line = value[1].GetString();
                if (string.IsNullOrWhiteSpace(line)) continue;
                GatewayAccessEventDTO? item;
                try { item = JsonSerializer.Deserialize<GatewayAccessEventDTO>(line, GatewayJsonOptions); }
                catch (JsonException) { continue; }
                if (item == null || item.SchemaVersion != 1 || item.InstanceId != instanceId
                    || string.IsNullOrWhiteSpace(item.EventId)) continue;
                yield return item;
            }
        }
    }

    private static async Task<string> ReadLokiResponseAsync(HttpContent content)
    {
        if (content.Headers.ContentLength is > MaxLokiResponseBytes)
            throw new InvalidOperationException("Loki response exceeds the instance log response limit.");

        await using var source = await content.ReadAsStreamAsync();
        await using var destination = new MemoryStream();
        var buffer = new byte[16 * 1024];
        int read;
        while ((read = await source.ReadAsync(buffer)) > 0)
        {
            if (destination.Length + read > MaxLokiResponseBytes)
                throw new InvalidOperationException("Loki response exceeds the instance log response limit.");
            await destination.WriteAsync(buffer.AsMemory(0, read));
        }
        return Encoding.UTF8.GetString(destination.GetBuffer(), 0, (int)destination.Length);
    }

    private static bool EventMatches(GatewayAccessEventDTO item, InstanceRequestLogFiltersDTO? filters)
    {
        if (filters == null) return true;
        return (filters.Protocol == null || filters.Protocol.Count == 0 || filters.Protocol.Contains(item.Protocol, StringComparer.OrdinalIgnoreCase))
            && (filters.Events == null || filters.Events.Count == 0 || filters.Events.Contains(item.Event, StringComparer.OrdinalIgnoreCase))
            && (filters.Status == null || filters.Status.Count == 0 || (item.Status.HasValue && filters.Status.Contains(item.Status.Value)))
            && (filters.Outcome == null || filters.Outcome.Count == 0 || (item.Outcome != null && filters.Outcome.Contains(item.Outcome, StringComparer.OrdinalIgnoreCase)))
            && (string.IsNullOrWhiteSpace(filters.ActorUserRef) || item.ActorUserRef == filters.ActorUserRef);
    }

    private sealed record CursorState(DateTimeOffset OccurredAt, string EventId);
    private static readonly JsonSerializerOptions GatewayJsonOptions = new() { PropertyNameCaseInsensitive = true };

    private static string BuildFilterHash(InstanceRequestLogFiltersDTO? filters)
    {
        var serialized = JsonSerializer.Serialize(filters);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(serialized)));
    }

    private static string CreateCursor(string instanceId, string filterHash, DateTimeOffset occurredAt, string eventId)
    {
        var payload = JsonSerializer.Serialize(new { instanceId, filterHash, occurredAt, eventId, expiresAt = DateTimeOffset.UtcNow.AddMinutes(10) });
        var body = ToBase64Url(Encoding.UTF8.GetBytes(payload));
        var signature = ToBase64Url(HMACSHA256.HashData(CursorKey(), Encoding.UTF8.GetBytes(body)));
        return body + "." + signature;
    }

    private static bool TryReadCursor(string cursor, string instanceId, string filterHash, out CursorState? state)
    {
        state = null;
        try
        {
            var parts = cursor.Split('.', 2);
            if (parts.Length != 2 || !CryptographicOperations.FixedTimeEquals(FromBase64Url(parts[1]), HMACSHA256.HashData(CursorKey(), Encoding.UTF8.GetBytes(parts[0])))) return false;
            using var doc = JsonDocument.Parse(Encoding.UTF8.GetString(FromBase64Url(parts[0])));
            var root = doc.RootElement;
            if (root.GetProperty("instanceId").GetString() != instanceId
                || root.GetProperty("filterHash").GetString() != filterHash
                || root.GetProperty("expiresAt").GetDateTimeOffset() < DateTimeOffset.UtcNow) return false;
            state = new CursorState(root.GetProperty("occurredAt").GetDateTimeOffset(), root.GetProperty("eventId").GetString() ?? string.Empty);
            return state.EventId.Length > 0;
        }
        catch (Exception) { return false; }
    }

    private static byte[] CursorKey()
    {
        var secret = Environment.GetEnvironmentVariable("INSTANCE_LOG_CURSOR_KEY");
        if (string.IsNullOrWhiteSpace(secret))
            throw new InvalidOperationException("Missing INSTANCE_LOG_CURSOR_KEY");
        return Encoding.UTF8.GetBytes(secret);
    }
    private static string ToBase64Url(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] FromBase64Url(string value)
    {
        value = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(value.PadRight(value.Length + (4 - value.Length % 4) % 4, '='));
    }

}

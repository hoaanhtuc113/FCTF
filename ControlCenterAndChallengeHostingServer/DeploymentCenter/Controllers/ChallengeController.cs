using DeploymentCenter.Middlewares;
using DeploymentCenter.Services;
using DeploymentCenter.Utils;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.Net;
using System.Text.Json;
using RestSharp;

namespace DeploymentCenter.Controllers;

[Route("api/[controller]")]
[ApiController]
public class ChallengeController : ControllerBase
{

    private readonly IDeployService _deployService;
    private readonly AppDbContext _dbContext;
    private readonly MultiServiceConnector _multiServiceConnector;
    public ChallengeController(
        IDeployService deployService,
        AppDbContext dbContext,
        MultiServiceConnector multiServiceConnector)
    {
        _deployService = deployService;
        _dbContext = dbContext;
        _multiServiceConnector = multiServiceConnector;
    }

    [HttpPost("start")]
    [RequireSecretKey]
    public async Task<IActionResult> StartChallenge([FromBody] ChallengeStartStopReqDTO challengeStartReq)
    {
        await Console.Out.WriteLineAsync($"Received Start Challenge request. Challenge{challengeStartReq.challengeId}, Team{challengeStartReq.teamId}, User{challengeStartReq.userId}");

        if (challengeStartReq == null
            || challengeStartReq.challengeId <= 0
            || challengeStartReq.teamId == 0
            || challengeStartReq.userId == null)
        {
            return BadRequest(new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.BadRequest,
                success = false,
                message = "Invalid request data."
            });
        }
        var response = await _deployService.Start(challengeStartReq);
        return response.status switch
        {
            (int)HttpStatusCode.OK => Ok(response),
            (int)HttpStatusCode.BadRequest => BadRequest(response),
            (int)HttpStatusCode.NotFound => NotFound(response),
            _ => StatusCode(response.status, response)
        };
    }

    [HttpPost("stop")]
    [RequireSecretKey]
    public async Task<IActionResult> StopChallenge([FromBody] ChallengeStartStopReqDTO challengeStopReq)
    {
        if (challengeStopReq == null
            || challengeStopReq.challengeId <= 0
            || challengeStopReq.teamId == 0)
        {
            return BadRequest(new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.BadRequest,
                success = false,
                message = "Invalid request data."
            });
        }
        var response = await _deployService.Stop(challengeStopReq);
        return response.status switch
        {
            (int)HttpStatusCode.OK => Ok(response),
            (int)HttpStatusCode.BadRequest => BadRequest(response),
            (int)HttpStatusCode.NotFound => NotFound(response),
            _ => StatusCode(response.status, response)
        };
    }

    // Stops every challenge namespace for ONE specific contest. contestId is
    // required - use /stop-all-global for every contest at once.
    [HttpPost("stop-all")]
    [RequireSecretKey]
    public async Task<IActionResult> StopAllChallenges([FromBody] ChallengeStartStopReqDTO challengeStopReq)
    {
        var user = await _dbContext.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == challengeStopReq.userId);
        if (user == null || user.Type != "admin")
        {
            return BadRequest(new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.BadRequest,
                success = false,
                message = "Unauthorized request."
            });
        }

        if (challengeStopReq.contestId is not > 0)
        {
            return BadRequest(new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.BadRequest,
                success = false,
                message = "contestId is required. Use /stop-all-global to stop every contest's challenges."
            });
        }

        await Console.Out.WriteLineAsync($"[Stop All] Account {user.Name} stop all challenges for contest {challengeStopReq.contestId}");
        var response = await _deployService.StopAll(challengeStopReq.contestId.Value);
        return response.HttpStatusCode switch
        {
            HttpStatusCode.OK => Ok(response),
            HttpStatusCode.BadRequest => BadRequest(response),
            _ => StatusCode((int)response.HttpStatusCode, response)
        };
    }

    // Stops EVERY challenge namespace across EVERY contest. Split out from
    // /stop-all (rather than a contestId=0 fallback there) so this
    // maximum-blast-radius action requires its own explicit confirmation
    // phrase, not just an admin forgetting to pass a contestId.
    [HttpPost("stop-all-global")]
    [RequireSecretKey]
    public async Task<IActionResult> StopAllChallengesGlobal([FromBody] StopAllGlobalReqDTO req)
    {
        var user = await _dbContext.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == req.userId);
        if (user == null || user.Type != "admin")
        {
            return BadRequest(new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.BadRequest,
                success = false,
                message = "Unauthorized request."
            });
        }

        if (req.confirm != StopAllGlobalConfirmationPhrase)
        {
            return BadRequest(new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.BadRequest,
                success = false,
                message = $"This stops every running contest's challenges. Resend with confirm=\"{StopAllGlobalConfirmationPhrase}\" to proceed."
            });
        }

        await Console.Out.WriteLineAsync($"[Stop All GLOBAL] Account {user.Name} stopping ALL challenges across ALL contests");
        var response = await _deployService.StopAllGlobal(user.Id);
        return response.HttpStatusCode switch
        {
            HttpStatusCode.OK => Ok(response),
            HttpStatusCode.BadRequest => BadRequest(response),
            _ => StatusCode((int)response.HttpStatusCode, response)
        };
    }

    private const string StopAllGlobalConfirmationPhrase = "CONFIRM_STOP_ALL_CONTESTS";

    [HttpPost("deployment-logs/{workflowName}")]
    [RequireSecretKey]
    public async Task<IActionResult> GetDeploymentLogs(
        string workflowName,
        [FromBody] ChallengeStartStopReqDTO challengeStopReq)
    {

        var response = await _deployService.GetDeploymentLogs(workflowName);
        return response.HttpStatusCode switch
        {
            HttpStatusCode.OK => Ok(response),
            HttpStatusCode.BadRequest => BadRequest(response),
            HttpStatusCode.NotFound => NotFound(response),
            _ => StatusCode((int)response.HttpStatusCode, response)
        };
    }

    [HttpPost("pod-logs")]
    [RequireSecretKey]
    public async Task<IActionResult> GetPodLogs([FromBody] ChallengeStartStopReqDTO challengeReq)
    {
        var response = await _deployService.GetPodLogs(challengeReq);
        return response.HttpStatusCode switch
        {
            HttpStatusCode.OK => Ok(response),
            HttpStatusCode.BadRequest => BadRequest(response),
            HttpStatusCode.NotFound => NotFound(response),
            _ => StatusCode((int)response.HttpStatusCode, response)
        };
    }

    [HttpPost("request-logs")]
    [RequireSecretKey]
    public async Task<IActionResult> GetPodRequestLog([FromBody] ChallengeStartStopReqDTO challengeReq)
    {
        var response = await _deployService.GetPodRequestLog(challengeReq);
        return response.HttpStatusCode switch
        {
            HttpStatusCode.OK => Ok(response),
            HttpStatusCode.BadRequest => BadRequest(response),
            HttpStatusCode.NotFound => NotFound(response),
            _ => StatusCode((int)response.HttpStatusCode, response)
        };
    }

    [HttpPost("upload")]
    [RequireSecretKey]
    public async Task<IActionResult> SubmitUploadWorkflow([FromBody] ChallengeUploadWorkflowReqDTO req)
    {
        if (req == null
            || req.challengeId <= 0
            || string.IsNullOrWhiteSpace(req.challengePath)
            || string.IsNullOrWhiteSpace(req.imageTag))
        {
            return BadRequest(new
            {
                success = false,
                message = "Invalid upload workflow request data."
            });
        }

        var upChallengeTemplate = Environment.GetEnvironmentVariable("UP_CHALLENGE_TEMPLATE");
        if (string.IsNullOrWhiteSpace(upChallengeTemplate))
        {
            return StatusCode((int)HttpStatusCode.InternalServerError, new
            {
                success = false,
                message = "Missing UP_CHALLENGE_TEMPLATE environment variable."
            });
        }

        var payload = new
        {
            resourceKind = "WorkflowTemplate",
            resourceName = upChallengeTemplate,
            submitOptions = new
            {
                entryPoint = "main",
                parameters = new[]
                {
                    $"CHALLENGE_ID={req.challengeId}",
                    $"CHALLENGE_PATH={req.challengePath}",
                    $"IMAGE_TAG={req.imageTag}",
                }
            }
        };

        // Token resolution reads the service account token file and throws when it
        // cannot. Keep it inside the try so the caller gets the reason instead of an
        // unhandled exception turning into an opaque 500 from the outer middleware.
        try
        {
            var headers = new Dictionary<string, string>
            {
                ["Authorization"] = $"Bearer {DeploymentCenterConfigHelper.GetArgoWorkflowsBearerToken()}"
            };

            var argoResponse = await _multiServiceConnector.ExecuteRequest(
                DeploymentCenterConfigHelper.ARGO_WORKFLOWS_URL,
                "/submit",
                Method.Post,
                payload,
                headers);

            if (string.IsNullOrWhiteSpace(argoResponse))
            {
                return StatusCode((int)HttpStatusCode.BadGateway, new
                {
                    success = false,
                    message = "Empty response from Argo Workflows API."
                });
            }

            using var _ = JsonDocument.Parse(argoResponse);
            return Content(argoResponse, "application/json");
        }
        catch (Exception ex)
        {
            return StatusCode((int)HttpStatusCode.BadGateway, new
            {
                success = false,
                message = $"Failed to submit upload workflow to Argo: {ex.Message}"
            });
        }
    }

    [HttpPost("workflow-status")]
    [RequireSecretKey]
    public async Task<IActionResult> GetWorkflowStatus([FromBody] ChallengeWorkflowStatusReqDTO req)
    {
        if (req == null || string.IsNullOrWhiteSpace(req.workflowName))
        {
            return BadRequest(new
            {
                success = false,
                message = "workflowName is required."
            });
        }

        try
        {
            var headers = new Dictionary<string, string>
            {
                ["Authorization"] = $"Bearer {DeploymentCenterConfigHelper.GetArgoWorkflowsBearerToken()}"
            };

            var argoResponse = await _multiServiceConnector.ExecuteRequest(
                DeploymentCenterConfigHelper.ARGO_WORKFLOWS_URL,
                $"/{req.workflowName}",
                Method.Get,
                new { },
                headers);

            if (string.IsNullOrWhiteSpace(argoResponse))
            {
                return StatusCode((int)HttpStatusCode.BadGateway, new
                {
                    success = false,
                    message = "Empty response from Argo Workflows API."
                });
            }

            using var doc = JsonDocument.Parse(argoResponse);
            var status = doc.RootElement.TryGetProperty("status", out var statusElement)
                ? statusElement
                : default;

            var workflowPhase = status.ValueKind != JsonValueKind.Undefined && status.TryGetProperty("phase", out var phaseElement)
                ? phaseElement.GetString() ?? "Running"
                : "Running";
            var startedAt = status.ValueKind != JsonValueKind.Undefined && status.TryGetProperty("startedAt", out var startedAtElement)
                ? startedAtElement.GetString()
                : null;
            var estimatedDuration = status.ValueKind != JsonValueKind.Undefined && status.TryGetProperty("estimatedDuration", out var estimatedDurationElement)
                ? estimatedDurationElement.GetInt32()
                : 90;

            return Ok(new
            {
                success = true,
                data = new
                {
                    phase = workflowPhase,
                    startedAt,
                    estimatedDuration
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode((int)HttpStatusCode.BadGateway, new
            {
                success = false,
                message = $"Failed to get workflow status from Argo: {ex.Message}"
            });
        }
    }
}

public class ChallengeUploadWorkflowReqDTO
{
    public int challengeId { get; set; }
    public string challengePath { get; set; } = string.Empty;
    public string imageTag { get; set; } = string.Empty;
    public string unixTime { get; set; } = string.Empty;
}

public class ChallengeWorkflowStatusReqDTO
{
    public string workflowName { get; set; } = string.Empty;
    public string unixTime { get; set; } = string.Empty;
}

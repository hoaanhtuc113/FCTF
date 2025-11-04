using DeploymentCenter.Middlewares;
using DeploymentCenter.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared;
using ResourceShared.Attribute;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Extensions;
using ResourceShared.Models;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Net;
using System.Net.WebSockets;
using System.Text.Json;

namespace HealthCheckService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class StatusCheckController : ControllerBase
    {

        private readonly IDeployService _deployService;
        public StatusCheckController( IDeployService deployService)
        {
            _deployService = deployService;
        }

        [HttpGet("status")]
        public IActionResult GetStatus()
        {
            return Ok(new { status = "Healthy" });
        }

        [HttpPost("start")]
        [RequireAuth]
        public async Task<ChallengeStartResponeDTO> StartChallengeChecking([FromBody] ChallengCheckStatusReqDTO statusReq)
        {
            var user = HttpContext.GetCurrentUser();

            if (user == null)
            {
                return new ChallengeStartResponeDTO
                {
                    success = false,
                    message = "Unauthorized",
                    status = (int)HttpStatusCode.Unauthorized
                };
            }

            if (string.IsNullOrEmpty(statusReq.teamName))
            {
               statusReq.teamName =  user.Team.Name;
            }

            if (statusReq == null || string.IsNullOrEmpty(statusReq.teamName) || statusReq.challengeId <= 0)
            {
                return new ChallengeStartResponeDTO
                {
                    success = false,
                    message = "Invalid request parameters",
                    status = (int)HttpStatusCode.BadRequest
                };
            }
            //NOTE: this state for runing in local with out k8s cubeconfig 
            return new ChallengeStartResponeDTO
            {
                success = true,
                message = "Challenge status checking started",
                status = (int)HttpStatusCode.OK,
                challenge_url = "http://demo-domain-for-testing.com"

            };
            var data = await _deployService.StatusCheck(statusReq);

            return data;
        }

        [HttpPost("admin-start")]
        [RequireSecretKey]
        public async Task<ChallengeStartResponeDTO> StartChallengeCheckingForAdmin([FromBody] ChallengCheckStatusReqDTO statusReq)
        {
            if (statusReq == null || string.IsNullOrEmpty(statusReq.teamName) || statusReq.challengeId <= 0)
            {
                return new ChallengeStartResponeDTO
                {
                    success = false,
                    message = "Invalid request parameters",
                    status = (int)HttpStatusCode.BadRequest
                };
            }
            //NOTE: this state for runing in local with out k8s cubeconfig 
            return new ChallengeStartResponeDTO
            {
                success = true,
                message = "Challenge status checking started",
                status = (int)HttpStatusCode.OK,
                challenge_url = "http://demo-domain-for-testing.com"

            };
            var data = await _deployService.StatusCheck(statusReq);

            return data;
        }

        [HttpPost("message")]
        public async Task<BaseResponseDTO> MessageFromArgo([FromBody] WorkflowStatusDTO message)
        {

            if (message == null )
            {
                return new BaseResponseDTO
                {
                    Success = false,
                    Message = "Invalid request parameters",
                    HttpStatusCode = HttpStatusCode.BadRequest
                };
            }

            return await _deployService.HandleMessageFromArgo(message);
        }
    }
}

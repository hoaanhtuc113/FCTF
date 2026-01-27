using DeploymentCenter.Middlewares;
using DeploymentCenter.Services;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using System.Net;

namespace DeploymentCenter.Controllers
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
        [RequireSecretKey]
        public async Task<ChallengeDeployResponeDTO> StartChallengeChecking([FromBody] ChallengCheckStatusReqDTO statusReq)
        {
            if (statusReq == null || statusReq.challengeId <= 0 || statusReq.teamId <= 0)
            {
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Invalid request parameters",
                    status = (int)HttpStatusCode.BadRequest
                };
            }
            var data = await _deployService.StatusCheck(statusReq);

            return data;
        }

        [HttpPost("admin-start")]
        [RequireSecretKey]
        public async Task<ChallengeDeployResponeDTO> StartChallengeCheckingForAdmin([FromBody] ChallengCheckStatusReqDTO statusReq)
        {
            if (statusReq == null || statusReq.teamId == 0|| statusReq.challengeId <= 0)
            {
                return new ChallengeDeployResponeDTO
                {
                    success = false,
                    message = "Invalid request parameters",
                    status = (int)HttpStatusCode.BadRequest
                };
            }
            var data = await _deployService.StatusCheck(statusReq);

            return data;
        }

        //AUTHENTICATION-NOTE: api này chưa được authen 
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

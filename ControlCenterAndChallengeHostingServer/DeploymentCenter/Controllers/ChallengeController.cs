using DeploymentCenter.Middlewares;
using DeploymentCenter.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Models;
using Sprache;
using System.Net;

namespace DeploymentCenter.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ChallengeController : ControllerBase
    {

        private readonly IDeployService _deployService;
        public ChallengeController(IDeployService deployService)
        {
            _deployService = deployService;
        }

        [HttpPost("start")]
        [RequireSecretKey]
        public async Task<IActionResult> StartChallenge([FromBody] ChallengeStartStopReqDTO challengeStartReq)
        {
            if (challengeStartReq == null || challengeStartReq.challengeId <= 0 || string.IsNullOrEmpty(challengeStartReq.teamName))
            {
                return BadRequest(new ChallengeStartResponeDTO
                {
                    status = (int) HttpStatusCode.BadRequest,
                    success = false,
                    message = "Invalid request data."
                });
            }
            var response = await _deployService.Start(challengeStartReq.challengeId, challengeStartReq.teamName, challengeStartReq.teamName);
            if(response.challenge_url != null)
            {
                var message = $"{response.message} <br><br>Running challenge is: {challengeStartReq.teamName}";
                response.message = message;
            }

            return response.status switch
            {
                (int)HttpStatusCode.OK => Ok(response),
                (int)HttpStatusCode.BadRequest => BadRequest(response),
                (int)HttpStatusCode.NotFound => NotFound(response),
                _ => StatusCode((int)response.status, response)
            };
        }
    }
}

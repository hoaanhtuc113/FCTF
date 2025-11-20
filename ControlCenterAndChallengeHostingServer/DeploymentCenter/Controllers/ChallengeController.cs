using DeploymentCenter.Middlewares;
using DeploymentCenter.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
        private readonly AppDbContext _dbContext;
        public ChallengeController(IDeployService deployService, AppDbContext dbContext)
        {
            _deployService = deployService;
            _dbContext = dbContext;
        }

        [HttpPost("start")]
        [RequireSecretKey]
        public async Task<IActionResult> StartChallenge([FromBody] ChallengeStartStopReqDTO challengeStartReq)
        {
            await Console.Out.WriteLineAsync($"Received Start Challenge request. Challenge{challengeStartReq.challengeId}, Team{challengeStartReq.teamId}, User{challengeStartReq.userId}");
            if (challengeStartReq == null || challengeStartReq.challengeId <= 0 || challengeStartReq.teamId == 0 || challengeStartReq.userId == null)
            {
                return BadRequest(new ChallengeDeployResponeDTO
                {
                    status = (int) HttpStatusCode.BadRequest,
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
                _ => StatusCode((int)response.status, response)
            };
        }

        [HttpPost("stop")]
        [RequireSecretKey]
        public async Task<IActionResult> StopChallenge([FromBody] ChallengeStartStopReqDTO challengeStopReq)
        {
            if (challengeStopReq == null || challengeStopReq.challengeId <= 0 || challengeStopReq.teamId == 0)
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
                _ => StatusCode((int)response.status, response)
            };
        }

        [HttpPost("stop-all")]
        [RequireSecretKey]
        public async Task<IActionResult> StopAllChallenges([FromBody] ChallengeStartStopReqDTO challengeStopReq)
        {
            var user = _dbContext.Users.FirstOrDefault(u => u.Id == challengeStopReq.userId);
            if (user == null || user.Type != "admin")
            {
                return BadRequest(new ChallengeDeployResponeDTO
                {
                    status = (int)HttpStatusCode.BadRequest,
                    success = false,
                    message = "Unauthorized request."
                });
            }
            var response = await _deployService.StopAll();
            return response.HttpStatusCode switch
            {
                HttpStatusCode.OK => Ok(response),
                HttpStatusCode.BadRequest => BadRequest(response),
                _ => StatusCode((int)response.HttpStatusCode, response)
            };
        }

        [HttpPost("deployment-logs/{workflowName}")]
        [RequireSecretKey]
        public async Task<IActionResult> GetDeploymentLogs(string workflowName,[FromBody] ChallengeStartStopReqDTO challengeStopReq)
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
            Console.WriteLine($"GetPodLogs: Received request for challenge ID: {challengeReq.challengeId}, Team ID: {challengeReq.teamId}");
            var response = await _deployService.GetPodLogs(challengeReq);
            return response.HttpStatusCode switch
            {
                HttpStatusCode.OK => Ok(response),
                HttpStatusCode.BadRequest => BadRequest(response),
                HttpStatusCode.NotFound => NotFound(response),
                _ => StatusCode((int)response.HttpStatusCode, response)
            };
        } 
    }
}

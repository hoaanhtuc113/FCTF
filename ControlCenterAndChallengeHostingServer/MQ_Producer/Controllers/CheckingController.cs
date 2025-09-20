using Microsoft.AspNetCore.Mvc;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.Models;
using ResourceShared.ResponseViews;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;

namespace MQ_Producer.Controllers
{
    [Route("mq/[controller]")]
    [ApiController]
    public class CheckingController : ControllerBase
    {
        private readonly IConnectionMultiplexer _connectionMultiplexer;
        public CheckingController(IConnectionMultiplexer connectionMultiplexer)
        {
            _connectionMultiplexer = connectionMultiplexer;
        }

        [HttpPost("start-challenge")]
        public async Task<IActionResult> CheckStartChallenge([FromBody] CheckingStartChallengeStatusReq challengeInfo)
        {
            Console.WriteLine($"[CheckingController] - CheckStartChallenge: ChallengeId={challengeInfo.ChallengeId}, TeamId={challengeInfo.TeamId}");
            RedisHelper redisHelper = new RedisHelper(_connectionMultiplexer);

            string redisDeployKey = $"{RedisConfigs.RedisStartedChallengeKey}_{challengeInfo.ChallengeId}_{challengeInfo.TeamId}";
            var redisGetDeployInfo = await redisHelper.GetFromCacheAsync<DeploymentInfo>(redisDeployKey);

            if (redisGetDeployInfo == null)
            {
                return NotFound(new { message = "Not found deployment info" });
            }

            if (redisGetDeployInfo.Status == "Failed")
            {
                return Ok(new GenaralViewResponseData<string>
                {
                    IsSuccess = false,
                    Message = $"Failed to start challenge",
                });
            }

            if (redisGetDeployInfo.Status == "Creating")
            {
                return Ok(new GenaralViewResponseData<string>
                {
                    IsSuccess = false,
                    Message = $"Start Challeng in progess",
                });
            }

            return Ok(new GenaralViewResponseData<string>
            {
                IsSuccess = true,
                Message = $"Start challenge successfully",
                data = redisGetDeployInfo.DeploymentDomainName,
            });
        }
    }
}

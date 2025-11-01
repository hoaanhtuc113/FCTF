using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.Configs;
using ResourceShared.DTOs.Challenge;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Net.WebSockets;

namespace HealthCheckService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class StatusCheckController : ControllerBase
    {

        private readonly RedisHelper _redisHelper;
        public StatusCheckController(RedisHelper redisHelper)
        {
            _redisHelper = redisHelper;
        }

        [HttpGet("status")]
        public IActionResult GetStatus()
        {
            return Ok(new { status = "Healthy" });
        }

        [HttpGet("start")]
        public async Task<IActionResult> StartChallengeChecking([FromBody] ChallengCheckStatusReqDTO statusReqDTO)
        {

            var startedChallengeKey = $"{RedisConfigs.RedisStartedChallengeKey}_{statusReqDTO.challengeId}_{statusReqDTO.teamId}";

            var data = await _redisHelper.GetFromCacheAsync<object>(startedChallengeKey);

            await Console.Out.WriteLineAsync($"Data from Redis for key {startedChallengeKey}: {data}");
            
            return Ok(new { data = data });
        }

        [HttpPost("message")]
        public async Task<IActionResult> MessageFromArgo([FromBody] string message)
        {
            await Console.Out.WriteLineAsync($"Received message: {message}");
            return Ok(new { message = message });
        }
        
    }
}

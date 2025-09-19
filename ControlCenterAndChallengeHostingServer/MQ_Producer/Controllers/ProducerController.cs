using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using MQ_Producer.Services;
using ResourceShared.DTOs;

namespace MQ_Producer.Controllers
{
    [Route("mq/[controller]")]
    [ApiController]
    public class ProducerController : ControllerBase
    {
        private readonly IPublisherService<StartChallengeInstanceRequest> _startChallengePublisherService;
        public ProducerController(IPublisherService<StartChallengeInstanceRequest> startChallengePublisherService)
        {
            _startChallengePublisherService = startChallengePublisherService;
        }

        [HttpGet]
        public IActionResult Get()
        {
            return Ok("MQ Producer is running");
        }

        // mq/producer/start-challenge
        [HttpPost("start-challenge")]
        public async Task<IActionResult> StartChallenge([FromBody] StartChallengeInstanceRequest request)
        {
            await Console.Out.WriteLineAsync($"MQ recive data  {request.TeamId} {request.ChallengeId}");
            await _startChallengePublisherService.PublishMessage(request);
            return Ok(new { message = "Message published successfully" });
        }
    }
}

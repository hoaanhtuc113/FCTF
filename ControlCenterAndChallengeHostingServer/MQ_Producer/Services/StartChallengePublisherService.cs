using MassTransit;
using Microsoft.AspNetCore.Http.HttpResults;
using ResourceShared.DTOs;

namespace MQ_Producer.Services
{
    public class StartChallengePublisherService : IPublisherService<StartChallengeInstanceRequest>
    {

        private readonly ILogger<StartChallengePublisherService> _logger;
        private readonly IPublishEndpoint _publishEndpoint;


        public StartChallengePublisherService(ILogger<StartChallengePublisherService> logger, IBus bus)
        {
            _logger = logger;
            _publishEndpoint = bus;
        }

        public async Task PublishMessage(StartChallengeInstanceRequest message)
        {
            _logger.LogInformation("Publishing start challenge message for ChallengeId: {ChallengeId}, TeamId: {TeamId}", message.ChallengeId, message.TeamId);
            await _publishEndpoint.Publish(message);
        }
    }
}

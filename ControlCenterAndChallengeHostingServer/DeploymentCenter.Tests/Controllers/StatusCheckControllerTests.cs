using Xunit;
using Moq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using HealthCheckService.Controllers;
using DeploymentCenter.Services;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using System.Net;

namespace DeploymentCenter.Tests.Controllers
{
    /// <summary>
    /// Unit tests cho StatusCheckController - API endpoints cho status checking và messages
    /// </summary>
    public class StatusCheckControllerTests
    {
        private readonly Mock<IDeployService> _mockDeployService;
        private readonly StatusCheckController _controller;

        public StatusCheckControllerTests()
        {
            _mockDeployService = new Mock<IDeployService>();
            _controller = new StatusCheckController(_mockDeployService.Object);
        }

        [Fact]
        public void GetStatus_ReturnsHealthyStatus()
        {
            // TEST CASE: Health check endpoint
            // Expected: Trả về status "Healthy"

            // Act
            var result = _controller.GetStatus();

            // Assert
            result.Should().BeOfType<OkObjectResult>();
            var okResult = result as OkObjectResult;
            var response = okResult!.Value;
            response.Should().BeEquivalentTo(new { status = "Healthy" });
        }

        [Fact]
        public async Task StartChallengeChecking_WithValidRequest_ReturnsSuccessResponse()
        {
            // TEST CASE: Start status checking với valid request
            // Expected: Trả về response từ service

            // Arrange
            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = 1,
                teamId = 1
            };

            var expectedResponse = new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.OK,
                success = true,
                message = "Status check started"
            };

            _mockDeployService.Setup(s => s.StatusCheck(It.IsAny<ChallengCheckStatusReqDTO>()))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.StartChallengeChecking(request);

            // Assert
            result.Should().BeEquivalentTo(expectedResponse);
            _mockDeployService.Verify(s => s.StatusCheck(request), Times.Once);
        }

        [Fact]
        public async Task StartChallengeChecking_WithInvalidChallengeId_ReturnsBadRequestResponse()
        {
            // TEST CASE: Start status checking với challengeId <= 0
            // Expected: Trả về BadRequest response

            // Arrange
            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = 0,
                teamId = 1
            };

            // Act
            var result = await _controller.StartChallengeChecking(request);

            // Assert
            result.success.Should().BeFalse();
            result.status.Should().Be((int)HttpStatusCode.BadRequest);
            result.message.Should().Be("Invalid request parameters");
            _mockDeployService.Verify(s => s.StatusCheck(It.IsAny<ChallengCheckStatusReqDTO>()), Times.Never);
        }

        [Fact]
        public async Task StartChallengeChecking_WithInvalidTeamId_ReturnsBadRequestResponse()
        {
            // TEST CASE: Start status checking với teamId <= 0
            // Expected: Trả về BadRequest response

            // Arrange
            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = 1,
                teamId = 0
            };

            // Act
            var result = await _controller.StartChallengeChecking(request);

            // Assert
            result.success.Should().BeFalse();
            result.status.Should().Be((int)HttpStatusCode.BadRequest);
            _mockDeployService.Verify(s => s.StatusCheck(It.IsAny<ChallengCheckStatusReqDTO>()), Times.Never);
        }

        [Fact]
        public async Task StartChallengeChecking_WithNullRequest_ReturnsBadRequestResponse()
        {
            // TEST CASE: Start status checking với null request
            // Expected: Trả về BadRequest response

            // Act
            var result = await _controller.StartChallengeChecking(null!);

            // Assert
            result.success.Should().BeFalse();
            result.status.Should().Be((int)HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task StartChallengeCheckingForAdmin_WithValidRequest_ReturnsSuccessResponse()
        {
            // TEST CASE: Admin start status checking với valid request
            // Expected: Trả về response từ service

            // Arrange
            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = 1,
                teamId = 1
            };

            var expectedResponse = new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.OK,
                success = true,
                message = "Status check started for admin"
            };

            _mockDeployService.Setup(s => s.StatusCheck(It.IsAny<ChallengCheckStatusReqDTO>()))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.StartChallengeCheckingForAdmin(request);

            // Assert
            result.Should().BeEquivalentTo(expectedResponse);
            _mockDeployService.Verify(s => s.StatusCheck(request), Times.Once);
        }

        [Fact]
        public async Task StartChallengeCheckingForAdmin_WithInvalidRequest_ReturnsBadRequestResponse()
        {
            // TEST CASE: Admin start với invalid parameters
            // Expected: Trả về BadRequest response

            // Arrange
            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = -1,
                teamId = 0
            };

            // Act
            var result = await _controller.StartChallengeCheckingForAdmin(request);

            // Assert
            result.success.Should().BeFalse();
            result.status.Should().Be((int)HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task MessageFromArgo_WithValidMessage_ReturnsSuccessResponse()
        {
            // TEST CASE: Nhận message từ Argo Workflows với valid data
            // Expected: Trả về success response từ service

            // Arrange
            var message = new WorkflowStatusDTO
            {
                // Populate with valid workflow status data
            };

            var expectedResponse = new BaseResponseDTO
            {
                HttpStatusCode = HttpStatusCode.OK,
                Success = true,
                Message = "Message processed"
            };

            _mockDeployService.Setup(s => s.HandleMessageFromArgo(It.IsAny<WorkflowStatusDTO>()))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.MessageFromArgo(message);

            // Assert
            result.Should().BeEquivalentTo(expectedResponse);
            _mockDeployService.Verify(s => s.HandleMessageFromArgo(message), Times.Once);
        }

        [Fact]
        public async Task MessageFromArgo_WithNullMessage_ReturnsBadRequestResponse()
        {
            // TEST CASE: Nhận null message từ Argo
            // Expected: Trả về BadRequest response

            // Act
            var result = await _controller.MessageFromArgo(null!);

            // Assert
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.BadRequest);
            result.Message.Should().Be("Invalid request parameters");
            _mockDeployService.Verify(s => s.HandleMessageFromArgo(It.IsAny<WorkflowStatusDTO>()), Times.Never);
        }

        [Fact]
        public async Task MessageFromArgo_WithServiceError_ReturnsErrorResponse()
        {
            // TEST CASE: Service xử lý message thất bại
            // Expected: Trả về error response

            // Arrange
            var message = new WorkflowStatusDTO();

            var expectedResponse = new BaseResponseDTO
            {
                HttpStatusCode = HttpStatusCode.InternalServerError,
                Success = false,
                Message = "Error processing message"
            };

            _mockDeployService.Setup(s => s.HandleMessageFromArgo(It.IsAny<WorkflowStatusDTO>()))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.MessageFromArgo(message);

            // Assert
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.InternalServerError);
        }
    }
}

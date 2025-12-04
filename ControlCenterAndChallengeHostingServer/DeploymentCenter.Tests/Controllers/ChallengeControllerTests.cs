using Xunit;
using Moq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DeploymentCenter.Controllers;
using DeploymentCenter.Services;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using ResourceShared.Models;
using System.Net;

namespace DeploymentCenter.Tests.Controllers
{
    /// <summary>
    /// Unit tests cho ChallengeController - API endpoints cho challenge deployment
    /// </summary>
    public class ChallengeControllerTests
    {
        private readonly Mock<IDeployService> _mockDeployService;
        private readonly AppDbContext _dbContext;
        private readonly ChallengeController _controller;

        public ChallengeControllerTests()
        {
            _mockDeployService = new Mock<IDeployService>();
            
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                .Options;
            _dbContext = new AppDbContext(options);
            
            _controller = new ChallengeController(_mockDeployService.Object, _dbContext);
        }

        [Fact]
        public async Task StartChallenge_WithValidRequest_ReturnsOkResult()
        {
            // TEST CASE: Start challenge với valid request
            // Expected: Trả về OkResult với response từ service

            // Arrange
            var challengeReq = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 100,
                userId = 123
            };

            var expectedResponse = new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.OK,
                success = true,
                message = "Challenge started"
            };

            _mockDeployService.Setup(s => s.Start(It.IsAny<ChallengeStartStopReqDTO>()))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.StartChallenge(challengeReq);

            // Assert
            result.Should().BeOfType<OkObjectResult>();
            var okResult = result as OkObjectResult;
            okResult!.Value.Should().BeEquivalentTo(expectedResponse);
            _mockDeployService.Verify(s => s.Start(challengeReq), Times.Once);
        }

        [Fact]
        public async Task StartChallenge_WithInvalidChallengeId_ReturnsBadRequest()
        {
            // TEST CASE: Start challenge với challengeId <= 0
            // Expected: Trả về BadRequest

            // Arrange
            var challengeReq = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 100,
                userId = null
            };

            // Act
            var result = await _controller.StartChallenge(challengeReq);

            // Assert
            result.Should().BeOfType<BadRequestObjectResult>();
            var badRequestResult = result as BadRequestObjectResult;
            var response = badRequestResult!.Value as ChallengeDeployResponeDTO;
            response!.success.Should().BeFalse();
            response.message.Should().Be("Invalid request data.");
        }

        [Fact]
        public async Task StartChallenge_WithNullUserId_ReturnsBadRequest()
        {
            // TEST CASE: Start challenge với userId null
            // Expected: Trả về BadRequest

            // Arrange
            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 1,
                userId = null
            };

            // Act
            var result = await _controller.StartChallenge(request);

            // Assert
            result.Should().BeOfType<BadRequestObjectResult>();
        }

        [Fact]
        public async Task StartChallenge_WithNotFoundResponse_ReturnsNotFound()
        {
            // TEST CASE: Service trả về NotFound status
            // Expected: Controller trả về NotFoundResult

            // Arrange
            var challengeReq = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 100,
                userId = 123
            };

            var expectedResponse = new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.NotFound,
                success = false,
                message = "Challenge not found"
            };

            _mockDeployService.Setup(s => s.Start(It.IsAny<ChallengeStartStopReqDTO>()))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.StartChallenge(challengeReq);

            // Assert
            result.Should().BeOfType<NotFoundObjectResult>();
        }

        [Fact]
        public async Task StopChallenge_WithValidRequest_ReturnsOkResult()
        {
            // TEST CASE: Stop challenge với valid request
            // Expected: Trả về OkResult

            // Arrange
            var challengeReq = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 1
            };

            var expectedResponse = new ChallengeDeployResponeDTO
            {
                status = (int)HttpStatusCode.OK,
                success = true,
                message = "Challenge stopped"
            };

            _mockDeployService.Setup(s => s.Stop(It.IsAny<ChallengeStartStopReqDTO>()))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.StopChallenge(challengeReq);

            // Assert
            result.Should().BeOfType<OkObjectResult>();
            _mockDeployService.Verify(s => s.Stop(challengeReq), Times.Once);
        }

        [Fact]
        public async Task StopChallenge_WithInvalidRequest_ReturnsBadRequest()
        {
            // TEST CASE: Stop challenge với invalid data
            // Expected: Trả về BadRequest

            // Arrange
            var request = new ChallengeStartStopReqDTO
            {
                challengeId = -1,
                teamId = 0
            };

            // Act
            var result = await _controller.StopChallenge(request);

            // Assert
            result.Should().BeOfType<BadRequestObjectResult>();
        }

        [Fact]
        public async Task StopAllChallenges_WithAdminUser_ReturnsOkResult()
        {
            // TEST CASE: StopAll được gọi bởi admin user
            // Expected: Trả về OkResult

            // Arrange
            var adminUser = new User
            {
                Id = 1,
                Type = "admin"
            };
            _dbContext.Users.Add(adminUser);
            await _dbContext.SaveChangesAsync();

            var request = new ChallengeStartStopReqDTO
            {
                userId = 1
            };

            var expectedResponse = new BaseResponseDTO
            {
                HttpStatusCode = HttpStatusCode.OK,
                Success = true,
                Message = "All challenges stopped"
            };

            _mockDeployService.Setup(s => s.StopAll())
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.StopAllChallenges(request);

            // Assert
            result.Should().BeOfType<OkObjectResult>();
            _mockDeployService.Verify(s => s.StopAll(), Times.Once);
        }

        [Fact]
        public async Task StopAllChallenges_WithNonAdminUser_ReturnsBadRequest()
        {
            // TEST CASE: StopAll được gọi bởi non-admin user
            // Expected: Trả về BadRequest với message "Unauthorized request"

            // Arrange
            var normalUser = new User
            {
                Id = 2,
                Type = "contestant"
            };
            _dbContext.Users.Add(normalUser);
            await _dbContext.SaveChangesAsync();

            var request = new ChallengeStartStopReqDTO
            {
                userId = 2
            };

            // Act
            var result = await _controller.StopAllChallenges(request);

            // Assert
            result.Should().BeOfType<BadRequestObjectResult>();
            var badRequestResult = result as BadRequestObjectResult;
            var response = badRequestResult!.Value as ChallengeDeployResponeDTO;
            response!.message.Should().Be("Unauthorized request.");
            _mockDeployService.Verify(s => s.StopAll(), Times.Never);
        }

        [Fact]
        public async Task StopAllChallenges_WithNonExistentUser_ReturnsBadRequest()
        {
            // TEST CASE: StopAll với userId không tồn tại
            // Expected: Trả về BadRequest

            // Arrange
            var request = new ChallengeStartStopReqDTO
            {
                userId = 999
            };

            // Act
            var result = await _controller.StopAllChallenges(request);

            // Assert
            result.Should().BeOfType<BadRequestObjectResult>();
            _mockDeployService.Verify(s => s.StopAll(), Times.Never);
        }

        [Fact]
        public async Task GetDeploymentLogs_WithValidWorkflowName_ReturnsOkResult()
        {
            // TEST CASE: Get deployment logs với valid workflow name
            // Expected: Trả về OkResult với logs

            // Arrange
            var workflowName = "workflow-123";
            var request = new ChallengeStartStopReqDTO();

            var expectedResponse = new BaseResponseDTO<DeploymentLogsDTO>
            {
                HttpStatusCode = HttpStatusCode.OK,
                Success = true,
                Message = "Logs retrieved"
            };

            _mockDeployService.Setup(s => s.GetDeploymentLogs(workflowName))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.GetDeploymentLogs(workflowName, request);

            // Assert
            result.Should().BeOfType<OkObjectResult>();
            _mockDeployService.Verify(s => s.GetDeploymentLogs(workflowName), Times.Once);
        }

        [Fact]
        public async Task GetDeploymentLogs_WithNotFoundWorkflow_ReturnsNotFound()
        {
            // TEST CASE: Get deployment logs với workflow không tồn tại
            // Expected: Trả về NotFoundResult

            // Arrange
            var workflowName = "nonexistent";
            var request = new ChallengeStartStopReqDTO();

            var expectedResponse = new BaseResponseDTO<DeploymentLogsDTO>
            {
                HttpStatusCode = HttpStatusCode.NotFound,
                Success = false,
                Message = "Workflow not found"
            };

            _mockDeployService.Setup(s => s.GetDeploymentLogs(workflowName))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.GetDeploymentLogs(workflowName, request);

            // Assert
            result.Should().BeOfType<NotFoundObjectResult>();
        }

        [Fact]
        public async Task GetPodLogs_WithValidRequest_ReturnsOkResult()
        {
            // TEST CASE: Get pod logs với valid request
            // Expected: Trả về OkResult với logs

            // Arrange
            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 1
            };

            var expectedResponse = new BaseResponseDTO<PodLogsDTO>
            {
                HttpStatusCode = HttpStatusCode.OK,
                Success = true,
                Message = "Pod logs retrieved"
            };

            _mockDeployService.Setup(s => s.GetPodLogs(request))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.GetPodLogs(request);

            // Assert
            result.Should().BeOfType<OkObjectResult>();
            _mockDeployService.Verify(s => s.GetPodLogs(request), Times.Once);
        }

        [Fact]
        public async Task GetPodLogs_WithNotFoundPod_ReturnsNotFound()
        {
            // TEST CASE: Get pod logs với pod không tồn tại
            // Expected: Trả về NotFoundResult

            // Arrange
            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 999,
                teamId = 999
            };

            var expectedResponse = new BaseResponseDTO<PodLogsDTO>
            {
                HttpStatusCode = HttpStatusCode.NotFound,
                Success = false,
                Message = "Pod not found"
            };

            _mockDeployService.Setup(s => s.GetPodLogs(request))
                .ReturnsAsync(expectedResponse);

            // Act
            var result = await _controller.GetPodLogs(request);

            // Assert
            result.Should().BeOfType<NotFoundObjectResult>();
        }
    }
}

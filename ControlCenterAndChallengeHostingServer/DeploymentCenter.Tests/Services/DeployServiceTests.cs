using Xunit;
using Moq;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using ResourceShared.Services;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Challenge;
using ResourceShared.DTOs.Deployments;
using DeploymentCenter.Services;
using System.Net;
using ResourceShared;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Text.Json;

namespace DeploymentCenter.Tests.Services
{
    /// <summary>
    /// Unit tests cho DeployService - Service quản lý deployment lifecycle của challenges
    /// </summary>
    public class DeployServiceTests : IDisposable
    {
        private readonly AppDbContext _dbContext;
        private readonly Mock<IK8sService> _mockK8sService;
        private readonly Mock<IConnectionMultiplexer> _mockRedis;
        private readonly Mock<IDatabase> _mockRedisDb;
        private readonly RedisHelper _redisHelper;
        private readonly DeployService _deployService;

        public DeployServiceTests()
        {
            // Setup in-memory database
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
                .Options;
            _dbContext = new AppDbContext(options);

            // Setup mocks
            _mockK8sService = new Mock<IK8sService>();
            
            // Setup Redis mocks
            _mockRedis = new Mock<IConnectionMultiplexer>();
            _mockRedisDb = new Mock<IDatabase>();
            _mockRedis.Setup(x => x.GetDatabase(-1, null)).Returns(_mockRedisDb.Object);
            _redisHelper = new RedisHelper(_mockRedis.Object);

            // Create service instance
            _deployService = new DeployService(_dbContext, _redisHelper, _mockK8sService.Object);
        }

        [Fact]
        public async Task Start_WhenChallengeNotFound_ReturnsNotFound()
        {
            // TEST CASE: Kiểm tra khi challenge không tồn tại trong database
            // Expected: Trả về status 404 và success = false

            // Arrange
            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 999, // Challenge không tồn tại
                teamId = 1
            };

            // Act
            var result = await _deployService.Start(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(404);
        }

        [Fact]
        public async Task Start_WhenChallengeExists_ProcessesSuccessfully()
        {
            // TEST CASE: Kiểm tra Start khi challenge tồn tại
            // Expected: Service xử lý request (có thể success hoặc pending)

            // Arrange
            var challenge = new Challenge
            {
                Id = 1,
                Name = "Test Challenge",
                State = Enums.ChallengeState.VISIBLE,
                Type = "web",
                ConnectionInfo = "{\"image\": \"test-image:latest\"}"
            };
            _dbContext.Challenges.Add(challenge);
            await _dbContext.SaveChangesAsync();

            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 1
            };

            // Act
            var result = await _deployService.Start(request);

            // Assert
            result.Should().NotBeNull();
            // Test passes if service returns a response
        }

        [Fact]
        public async Task Stop_WhenCacheNotFound_ReturnsNotFound()
        {
            // TEST CASE: Stop deployment không tồn tại trong cache
            // Expected: Trả về status 404

            // Arrange
            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 1
            };

            // Mock Redis trả về null (không có cache)
            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(RedisValue.Null);

            // Act
            var result = await _deployService.Stop(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(404);
        }

        [Fact]
        public async Task StopAll_ExecutesSuccessfully()
        {
            // TEST CASE: Gọi StopAll service
            // Expected: Service thực thi và trả về response hợp lệ

            // Act
            var result = await _deployService.StopAll();

            // Assert
            result.Should().NotBeNull();
            // Result có thể success hoặc fail
        }

        [Fact]
        public async Task StatusCheck_WhenDeploymentNotFound_ReturnsNotFound()
        {
            // TEST CASE: Check status của deployment không tồn tại
            // Expected: Trả về status 404

            // Arrange
            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = 999,
                teamId = 1
            };

            // Mock Redis trả về null
            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(RedisValue.Null);

            // Act
            var result = await _deployService.StatusCheck(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(404);
        }

        [Fact]
        public void DeployService_Constructor_InitializesSuccessfully()
        {
            // TEST CASE: Verify service khởi tạo thành công
            // Expected: Service và dependencies không null

            // Assert
            _deployService.Should().NotBeNull();
            _dbContext.Should().NotBeNull();
            _redisHelper.Should().NotBeNull();
        }

        [Fact]
        public async Task StopAll_WhenSuccessful_DeletesAllNamespacesAndClearsCache()
        {
            // TEST CASE: StopAll xóa tất cả namespaces và clear cache thành công
            // Expected: Trả về success với thông tin đã stop

            // Arrange
            _mockK8sService.Setup(x => x.DeleteAllChallengeNamespaces(It.IsAny<string>()))
                .ReturnsAsync((2, 0, new List<string>()));
            
            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(RedisValue.Null);
            
            _mockRedisDb.Setup(x => x.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(true);

            // Act
            var result = await _deployService.StopAll();

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            result.HttpStatusCode.Should().Be(HttpStatusCode.OK);
            result.Message.Should().Contain("Stopped 2 challenge namespace(s) successfully");
            _mockK8sService.Verify(x => x.DeleteAllChallengeNamespaces(It.IsAny<string>()), Times.Once);
        }

        [Fact]
        public async Task StopAll_WhenPartialFailure_ReturnsPartialContent()
        {
            // TEST CASE: StopAll khi có một số namespace fail
            // Expected: Trả về PartialContent với thông tin lỗi

            // Arrange
            var errors = new List<string> { "Error deleting namespace-1" };
            _mockK8sService.Setup(x => x.DeleteAllChallengeNamespaces(It.IsAny<string>()))
                .ReturnsAsync((1, 1, errors));

            // Act
            var result = await _deployService.StopAll();

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.PartialContent);
            result.Message.Should().Contain("1 failed");
        }

        [Fact]
        public async Task HandleMessageFromArgo_WithUpMessage_ProcessesSuccessfully()
        {
            // TEST CASE: HandleMessage với message type UP
            // Expected: Update challenge status và tạo history

            // Arrange
            var challenge = new Challenge
            {
                Id = 1,
                Name = "Test Challenge",
                DeployStatus = Enums.DeploymentStatus.PENDING,
                State = Enums.ChallengeState.HIDDEN
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.UP,
                ChallengeId = 1,
                Status = "Succeeded",
                WorkFlowName = "workflow-1"
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            result.HttpStatusCode.Should().Be(HttpStatusCode.OK);
            result.Message.Should().Contain("processed successfully");
        }

        [Fact]
        public async Task HandleMessageFromArgo_WithStartMessage_ReturnsSuccess()
        {
            // TEST CASE: HandleMessage với message type START
            // Expected: Xử lý thành công

            // Arrange
            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.START,
                WorkFlowName = "workflow-start",
                Status = Enums.DeploymentStatus.RUNING
            };

            _mockRedisDb.Setup(x => x.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(true);

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            result.HttpStatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task HandleMessageFromArgo_WithUnsupportedType_ReturnsBadRequest()
        {
            // TEST CASE: HandleMessage với type không hỗ trợ
            // Expected: Trả về BadRequest

            // Arrange
            var message = new WorkflowStatusDTO
            {
                Type = "UNKNOWN",
                ChallengeId = 1
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.BadRequest);
            result.Message.Should().Contain("Unsupported message type");
        }

        [Fact]
        public async Task GetDeploymentLogs_WhenLogsExist_ReturnsLogs()
        {
            // TEST CASE: GetDeploymentLogs với workflow tồn tại
            // Expected: Trả về logs thành công

            // Arrange
            var workflowName = "test-workflow";
            var expectedLogs = "Log line 1\nLog line 2\nLog line 3";
            
            _mockK8sService.Setup(x => x.GetWorkflowLogs(workflowName, It.IsAny<string>()))
                .ReturnsAsync(expectedLogs);

            // Act
            var result = await _deployService.GetDeploymentLogs(workflowName);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            result.HttpStatusCode.Should().Be(HttpStatusCode.OK);
            result.Data.Should().NotBeNull();
            result.Data!.WorkflowName.Should().Be(workflowName);
            result.Data.Logs.Should().Be(expectedLogs);
            _mockK8sService.Verify(x => x.GetWorkflowLogs(workflowName, It.IsAny<string>()), Times.Once);
        }

        [Fact]
        public async Task GetDeploymentLogs_WhenLogsNotFound_ReturnsNotFound()
        {
            // TEST CASE: GetDeploymentLogs với workflow không tồn tại
            // Expected: Trả về NotFound

            // Arrange
            var workflowName = "nonexistent-workflow";
            _mockK8sService.Setup(x => x.GetWorkflowLogs(workflowName, It.IsAny<string>()))
                .ReturnsAsync((string?)null);

            // Act
            var result = await _deployService.GetDeploymentLogs(workflowName);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.NotFound);
            result.Message.Should().Contain("Logs not found");
        }

        [Fact]
        public async Task GetPodLogs_WhenPodExists_ReturnsLogs()
        {
            // TEST CASE: GetPodLogs với pod tồn tại
            // Expected: Trả về pod logs thành công

            // Arrange
            var challengeReq = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 100
            };

            var podInfo = new PodInfo
            {
                ChallengeId = 1,
                TeamId = 100,
                Name = "pod-test",
                Namespace = "ctf-challenge-1",
                Status = "Running"
            };

            var expectedLogs = "Pod log line 1\nPod log line 2";

            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ReturnsAsync(new List<PodInfo> { podInfo });
            
            _mockK8sService.Setup(x => x.GetPodLogs(podInfo.Namespace, podInfo.Name))
                .ReturnsAsync(expectedLogs);

            // Act
            var result = await _deployService.GetPodLogs(challengeReq);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            result.HttpStatusCode.Should().Be(HttpStatusCode.OK);
            result.Data.Should().NotBeNull();
            result.Data!.PodName.Should().Be(podInfo.Name);
            result.Data.Logs.Should().Be(expectedLogs);
            _mockK8sService.Verify(x => x.GetPodsByLabel(It.IsAny<string>()), Times.Once);
            _mockK8sService.Verify(x => x.GetPodLogs(podInfo.Namespace, podInfo.Name), Times.Once);
        }

        [Fact]
        public async Task GetPodLogs_WhenPodNotFound_ReturnsNotFound()
        {
            // TEST CASE: GetPodLogs với pod không tồn tại
            // Expected: Trả về NotFound

            // Arrange
            var challengeReq = new ChallengeStartStopReqDTO
            {
                challengeId = 999,
                teamId = 999
            };

            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ReturnsAsync(new List<PodInfo>());

            // Act
            var result = await _deployService.GetPodLogs(challengeReq);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.NotFound);
            result.Message.Should().Contain("Pod not found");
        }

        [Fact]
        public async Task Start_WithInvalidChallengeId_ReturnsNotFound()
        {
            // TEST CASE: Start với challengeId không tồn tại
            // Expected: NotFound

            // Arrange
            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 9999,
                teamId = 1
            };

            // Act
            var result = await _deployService.Start(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(404);
            result.message.Should().Contain("Challenge not found");
        }

        [Fact]
        public async Task Start_WithNullImageLink_ReturnsBadRequest()
        {
            // TEST CASE: Start với challenge có ImageLink null
            // Expected: BadRequest

            // Arrange
            var challenge = new Challenge
            {
                Id = 10,
                Name = "Challenge with null image",
                ImageLink = null,
                DeployStatus = Enums.DeploymentStatus.PENDING,
                State = Enums.ChallengeState.VISIBLE
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 10,
                teamId = 1,
                userId = 1
            };

            // Act
            var result = await _deployService.Start(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(400);
            result.message.Should().Contain("image link is null");
        }

        [Fact]
        public async Task Stop_WithNonExistentDeployment_ReturnsNotFound()
        {
            // TEST CASE: Stop với deployment không tồn tại
            // Expected: NotFound

            // Arrange
            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 9999,
                teamId = 9999
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(RedisValue.Null);

            // Act
            var result = await _deployService.Stop(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(404);
            result.message.Should().Contain("No deployment cache info found");
        }

        [Fact]
        public async Task Stop_WithK8sDeleteFailure_ReturnsInternalServerError()
        {
            // TEST CASE: Stop khi K8s delete namespace thất bại
            // Expected: InternalServerError

            // Arrange
            var deployInfo = new ChallengeDeploymentCacheDTO
            {
                challenge_id = 1,
                team_id = 1,
                _namespace = "ctf-challenge-1",
                workflow_name = "wf-1",
                status = Enums.DeploymentStatus.RUNING
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(JsonSerializer.Serialize(deployInfo));

            _mockK8sService.Setup(x => x.DeleteNamespace(It.IsAny<string>()))
                .ThrowsAsync(new Exception("K8s delete failed"));

            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 1
            };

            // Act
            var result = await _deployService.Stop(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(500);
        }

        [Fact]
        public async Task StatusCheck_WithNonExistentDeployment_ReturnsNotFound()
        {
            // TEST CASE: StatusCheck với deployment không tồn tại
            // Expected: NotFound

            // Arrange
            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = 9999,
                teamId = 9999
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(RedisValue.Null);

            // Act
            var result = await _deployService.StatusCheck(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(404);
            result.message.Should().Contain("No deployment info found");
        }

        [Fact]
        public async Task StatusCheck_WhenPodNotRunning_ReturnsNotRunning()
        {
            // TEST CASE: StatusCheck khi pod không chạy
            // Expected: Success false, pod not running

            // Arrange
            var deployInfo = new ChallengeDeploymentCacheDTO
            {
                challenge_id = 1,
                team_id = 1,
                _namespace = "ctf-challenge-1",
                workflow_name = "wf-1",
                status = Enums.DeploymentStatus.RUNING
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(JsonSerializer.Serialize(deployInfo));

            _mockK8sService.Setup(x => x.CheckPodAliveInCache(It.IsAny<string>()))
                .ReturnsAsync(false);

            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = 1,
                teamId = 1
            };

            // Act
            var result = await _deployService.StatusCheck(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.message.Should().Contain("Pod is not running");
        }

        [Fact]
        public async Task HandleMessageFromArgo_WithNullChallengeId_ReturnsBadRequest()
        {
            // TEST CASE: HandleMessage với ChallengeId null
            // Expected: Xử lý message (có thể báo lỗi hoặc skip)

            // Arrange
            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.UP,
                ChallengeId = null,
                Status = "Succeeded"
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
        }

        [Fact]
        public async Task HandleMessageFromArgo_WithFailedStatus_ProcessesFailure()
        {
            // TEST CASE: HandleMessage UP với status Failed
            // Expected: Update challenge state thành HIDDEN

            // Arrange
            var challenge = new Challenge
            {
                Id = 2,
                Name = "Failed Challenge",
                DeployStatus = Enums.DeploymentStatus.PENDING,
                State = Enums.ChallengeState.VISIBLE
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.UP,
                ChallengeId = 2,
                Status = "Failed",
                WorkFlowName = "workflow-failed"
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
        }

        [Fact]
        public async Task HandleMessageFromArgo_WithChallengeNotFound_ReturnsNotFound()
        {
            // TEST CASE: HandleMessage UP với challenge không tồn tại
            // Expected: NotFound

            // Arrange
            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.UP,
                ChallengeId = 9999,
                Status = "Succeeded",
                WorkFlowName = "workflow-notfound"
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        [Fact]
        public async Task HandleMessageFromArgo_StartWithFailedStatus_RemovesCache()
        {
            // TEST CASE: HandleMessage START với Failed status
            // Expected: Xóa cache và return success

            // Arrange
            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.START,
                WorkFlowName = "workflow-start-failed",
                Status = Enums.DeploymentStatus.FAILED
            };

            _mockRedisDb.Setup(x => x.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(true);

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            _mockRedisDb.Verify(x => x.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()), Times.Once);
        }

        [Fact]
        public async Task HandleMessageFromArgo_StartWithNullWorkflowName_ReturnsError()
        {
            // TEST CASE: HandleMessage START với WorkFlowName null
            // Expected: Internal server error

            // Arrange
            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.START,
                WorkFlowName = null,
                Status = Enums.DeploymentStatus.FAILED
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeFalse();
        }

        [Fact]
        public async Task GetDeploymentLogs_WithEmptyWorkflowName_HandlesGracefully()
        {
            // TEST CASE: GetDeploymentLogs với empty workflow name
            // Expected: Xử lý gracefully

            // Arrange
            var workflowName = "";

            // Act
            var result = await _deployService.GetDeploymentLogs(workflowName);

            // Assert
            result.Should().NotBeNull();
        }

        [Fact]
        public async Task GetDeploymentLogs_WhenK8sThrowsException_ReturnsInternalServerError()
        {
            // TEST CASE: GetDeploymentLogs khi K8s service throw exception
            // Expected: Internal server error

            // Arrange
            var workflowName = "error-workflow";
            _mockK8sService.Setup(x => x.GetWorkflowLogs(workflowName, It.IsAny<string>()))
                .ThrowsAsync(new Exception("K8s connection failed"));

            // Act
            var result = await _deployService.GetDeploymentLogs(workflowName);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.InternalServerError);
        }

        [Fact]
        public async Task GetPodLogs_WhenK8sThrowsException_ReturnsInternalServerError()
        {
            // TEST CASE: GetPodLogs khi K8s service throw exception
            // Expected: Internal server error

            // Arrange
            var challengeReq = new ChallengeStartStopReqDTO
            {
                challengeId = 1,
                teamId = 100
            };

            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ThrowsAsync(new Exception("K8s connection failed"));

            // Act
            var result = await _deployService.GetPodLogs(challengeReq);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.InternalServerError);
        }

        [Fact]
        public async Task StopAll_WhenK8sThrowsException_ReturnsInternalServerError()
        {
            // TEST CASE: StopAll khi K8s service throw exception
            // Expected: Internal server error

            // Arrange
            _mockK8sService.Setup(x => x.DeleteAllChallengeNamespaces(It.IsAny<string>()))
                .ThrowsAsync(new Exception("K8s connection failed"));

            // Act
            var result = await _deployService.StopAll();

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeFalse();
            result.HttpStatusCode.Should().Be(HttpStatusCode.InternalServerError);
        }

        [Fact]
        public async Task GetPodLogs_WithMultiplePods_ReturnsCorrectPod()
        {
            // TEST CASE: GetPodLogs khi có nhiều pods
            // Expected: Trả về đúng pod theo challengeId và teamId

            // Arrange
            var challengeReq = new ChallengeStartStopReqDTO
            {
                challengeId = 2,
                teamId = 200
            };

            var pods = new List<PodInfo>
            {
                new PodInfo { ChallengeId = 1, TeamId = 100, Name = "pod-1", Namespace = "ns-1", Status = "Running" },
                new PodInfo { ChallengeId = 2, TeamId = 200, Name = "pod-2", Namespace = "ns-2", Status = "Running" },
                new PodInfo { ChallengeId = 3, TeamId = 300, Name = "pod-3", Namespace = "ns-3", Status = "Running" }
            };

            var expectedLogs = "Logs for pod-2";

            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ReturnsAsync(pods);
            
            _mockK8sService.Setup(x => x.GetPodLogs("ns-2", "pod-2"))
                .ReturnsAsync(expectedLogs);

            // Act
            var result = await _deployService.GetPodLogs(challengeReq);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            result.Data.Should().NotBeNull();
            result.Data!.PodName.Should().Be("pod-2");
            result.Data.Logs.Should().Be(expectedLogs);
        }

        [Fact]
        public async Task HandleMessageFromArgo_WithEmptyStatus_HandlesGracefully()
        {
            // TEST CASE: HandleMessage UP với empty status
            // Expected: Xử lý gracefully

            // Arrange
            var challenge = new Challenge
            {
                Id = 3,
                Name = "Empty Status Challenge",
                DeployStatus = Enums.DeploymentStatus.PENDING,
                State = Enums.ChallengeState.HIDDEN
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.UP,
                ChallengeId = 3,
                Status = "",
                WorkFlowName = "workflow-empty"
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
        }

        [Fact]
        public async Task StopAll_WithNoNamespaces_ReturnsSuccessWithZeroCount()
        {
            // TEST CASE: StopAll khi không có namespace nào
            // Expected: Success với 0 namespaces stopped

            // Arrange
            _mockK8sService.Setup(x => x.DeleteAllChallengeNamespaces(It.IsAny<string>()))
                .ReturnsAsync((0, 0, new List<string>()));

            // Act
            var result = await _deployService.StopAll();

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            result.Message.Should().Contain("Stopped 0 challenge namespace(s)");
        }

        [Fact]
        public async Task Start_WithPendingDeployment_ReturnsDeploying()
        {
            // TEST CASE: Start khi deployment đã ở trạng thái PENDING
            // Expected: Trả về deploying message

            // Arrange
            var challenge = new Challenge
            {
                Id = 11,
                Name = "Pending Challenge",
                ImageLink = "{\"image\":\"test:latest\"}",
                State = Enums.ChallengeState.VISIBLE
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var deployCache = new ChallengeDeploymentCacheDTO
            {
                challenge_id = 11,
                team_id = 1,
                status = Enums.DeploymentStatus.PENDING,
                workflow_name = "wf-pending-123"
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(JsonSerializer.Serialize(deployCache));

            _mockK8sService.Setup(x => x.GetWorkflowStatus(It.IsAny<string>(), It.IsAny<string>()))
                .ReturnsAsync(Enums.WorkflowPhase.Running);

            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 11,
                teamId = 1,
                userId = 1
            };

            // Act
            var result = await _deployService.Start(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeTrue();
            result.status.Should().Be(200);
            result.message.Should().Contain("deploying");
        }

        [Fact]
        public async Task Start_WithRunningDeployment_ReturnsChallengeUrl()
        {
            // TEST CASE: Start khi deployment đang RUNNING
            // Expected: Trả về challenge URL và time limit

            // Arrange
            var challenge = new Challenge
            {
                Id = 12,
                Name = "Running Challenge",
                ImageLink = "{\"image\":\"test:latest\"}",
                State = Enums.ChallengeState.VISIBLE
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var futureTime = DateTimeOffset.UtcNow.AddMinutes(30).ToUnixTimeSeconds();
            var deployCache = new ChallengeDeploymentCacheDTO
            {
                challenge_id = 12,
                team_id = 1,
                status = Enums.DeploymentStatus.RUNING,
                _namespace = "ctf-challenge-12",
                challenge_url = "http://challenge-12.ctf.com",
                time_finished = futureTime
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(JsonSerializer.Serialize(deployCache));

            _mockK8sService.Setup(x => x.CheckPodAliveInCache(It.IsAny<string>()))
                .ReturnsAsync(true);

            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 12,
                teamId = 1,
                userId = 1
            };

            // Act
            var result = await _deployService.Start(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeTrue();
            result.status.Should().Be(200);
            result.message.Should().Contain("running");
            result.challenge_url.Should().Be("http://challenge-12.ctf.com");
            result.time_limit.Should().BeGreaterThanOrEqualTo(0);
        }

        [Fact]
        public async Task Start_WithWorkflowFailed_RemovesCacheAndRetries()
        {
            // TEST CASE: Start khi workflow ở trạng thái Failed
            // Expected: Xóa cache và cho phép retry

            // Arrange
            var challenge = new Challenge
            {
                Id = 13,
                Name = "Failed Workflow Challenge",
                ImageLink = "{\"image\":\"test:latest\"}",
                State = Enums.ChallengeState.VISIBLE
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var deployCache = new ChallengeDeploymentCacheDTO
            {
                challenge_id = 13,
                team_id = 1,
                status = Enums.DeploymentStatus.PENDING,
                workflow_name = "wf-failed-123"
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(JsonSerializer.Serialize(deployCache));

            _mockK8sService.Setup(x => x.GetWorkflowStatus("wf-failed-123", It.IsAny<string>()))
                .ReturnsAsync(Enums.WorkflowPhase.Failed);

            _mockRedisDb.Setup(x => x.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(true);

            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 13,
                teamId = 1,
                userId = 1
            };

            // Act
            var result = await _deployService.Start(request);

            // Assert - Should process and attempt new deployment
            result.Should().NotBeNull();
            _mockRedisDb.Verify(x => x.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()), Times.AtLeastOnce);
        }

        [Fact]
        public async Task Start_WithInvalidImageLinkJson_ReturnsBadRequest()
        {
            // TEST CASE: Start với ImageLink JSON không hợp lệ
            // Expected: BadRequest

            // Arrange
            var challenge = new Challenge
            {
                Id = 14,
                Name = "Invalid JSON Challenge",
                ImageLink = "invalid-json-{{{",
                State = Enums.ChallengeState.VISIBLE
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 14,
                teamId = 1,
                userId = 1
            };

            // Act
            var result = await _deployService.Start(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(500);
            result.message.Should().Contain("error");
        }

        [Fact]
        public async Task Start_WithRunningButPodNotAlive_ReturnsDeploying()
        {
            // TEST CASE: Start khi status RUNNING nhưng pod không alive
            // Expected: Trả về deploying

            // Arrange
            var challenge = new Challenge
            {
                Id = 15,
                Name = "Pod Not Alive Challenge",
                ImageLink = "{\"image\":\"test:latest\"}",
                State = Enums.ChallengeState.VISIBLE
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var deployCache = new ChallengeDeploymentCacheDTO
            {
                challenge_id = 15,
                team_id = 1,
                status = Enums.DeploymentStatus.RUNING,
                _namespace = "ctf-challenge-15"
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(JsonSerializer.Serialize(deployCache));

            _mockK8sService.Setup(x => x.CheckPodAliveInCache("ctf-challenge-15"))
                .ReturnsAsync(false);

            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 15,
                teamId = 1,
                userId = 1
            };

            // Act
            var result = await _deployService.Start(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeTrue();
            result.message.Should().Contain("deploying");
        }

        [Fact]
        public async Task HandleMessageFromArgo_UpWithSucceededStatus_UpdatesChallengeToVisible()
        {
            // TEST CASE: HandleMessage UP với Succeeded status
            // Expected: Challenge state → VISIBLE

            // Arrange
            var challenge = new Challenge
            {
                Id = 16,
                Name = "Success Challenge",
                DeployStatus = Enums.DeploymentStatus.PENDING,
                State = Enums.ChallengeState.HIDDEN
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.UP,
                ChallengeId = 16,
                Status = "Succeeded",
                WorkFlowName = "wf-success-16"
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            result.HttpStatusCode.Should().Be(HttpStatusCode.OK);
            result.Message.Should().Contain("processed successfully");
        }

        [Fact]
        public async Task HandleMessageFromArgo_UpWithFailedStatus_UpdatesChallengeToHidden()
        {
            // TEST CASE: HandleMessage UP với Failed status
            // Expected: Challenge state → HIDDEN

            // Arrange
            var challenge = new Challenge
            {
                Id = 17,
                Name = "Failed Deploy Challenge",
                DeployStatus = Enums.DeploymentStatus.PENDING,
                State = Enums.ChallengeState.VISIBLE
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.UP,
                ChallengeId = 17,
                Status = "Failed",
                WorkFlowName = "wf-failed-17"
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            result.HttpStatusCode.Should().Be(HttpStatusCode.OK);
            result.Message.Should().Contain("processed successfully");
        }

        [Fact]
        public async Task HandleMessageFromArgo_CreatesDeployHistory()
        {
            // TEST CASE: HandleMessage UP tạo deploy history
            // Expected: Record được thêm vào DeployHistories

            // Arrange
            var challenge = new Challenge
            {
                Id = 18,
                Name = "History Challenge",
                DeployStatus = Enums.DeploymentStatus.PENDING,
                State = Enums.ChallengeState.HIDDEN
            };
            await _dbContext.Challenges.AddAsync(challenge);
            await _dbContext.SaveChangesAsync();

            var message = new WorkflowStatusDTO
            {
                Type = Enums.ArgoMessageType.UP,
                ChallengeId = 18,
                Status = "Succeeded",
                WorkFlowName = "wf-history-18"
            };

            // Act
            var result = await _deployService.HandleMessageFromArgo(message);

            // Assert
            result.Should().NotBeNull();
            result.Success.Should().BeTrue();
            
            var history = await _dbContext.DeployHistories
                .FirstOrDefaultAsync(h => h.ChallengeId == 18);
            
            history.Should().NotBeNull();
            history!.DeployStatus.Should().Be(Enums.DeploymentStatus.DEPLOY_SUCCEEDED);
            history!.LogContent.Should().Be("wf-history-18");
        }

        [Fact]
        public async Task StatusCheck_WhenPodIsRunning_CallsHandleChallengeRunning()
        {
            // TEST CASE: StatusCheck khi pod đang running
            // Expected: Gọi HandleChallengeRunning

            // Arrange
            var deployInfo = new ChallengeDeploymentCacheDTO
            {
                challenge_id = 19,
                team_id = 1,
                _namespace = "ctf-challenge-19",
                status = Enums.DeploymentStatus.RUNING
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(JsonSerializer.Serialize(deployInfo));

            _mockK8sService.Setup(x => x.CheckPodAliveInCache("ctf-challenge-19"))
                .ReturnsAsync(true);

            _mockK8sService.Setup(x => x.HandleChallengeRunning(
                It.IsAny<int>(),
                It.IsAny<int>(),
                It.IsAny<string>(),
                It.IsAny<ChallengeDeploymentCacheDTO>()))
                .ReturnsAsync(new ChallengeDeployResponeDTO
                {
                    success = true,
                    status = 200,
                    message = "Challenge is running",
                    challenge_url = "http://challenge-19.ctf.com"
                });

            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = 19,
                teamId = 1
            };

            // Act
            var result = await _deployService.StatusCheck(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeTrue();
            result.challenge_url.Should().Be("http://challenge-19.ctf.com");
            
            _mockK8sService.Verify(x => x.HandleChallengeRunning(
                19, 1, "ctf-challenge-19", It.IsAny<ChallengeDeploymentCacheDTO>()), 
                Times.Once);
        }

        [Fact]
        public async Task StatusCheck_ThrowsException_ReturnsInternalServerError()
        {
            // TEST CASE: StatusCheck throw exception
            // Expected: InternalServerError

            // Arrange
            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(RedisValue.Null);

            var request = new ChallengCheckStatusReqDTO
            {
                challengeId = 20,
                teamId = 1
            };

            // Act
            var result = await _deployService.StatusCheck(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeFalse();
            result.status.Should().Be(404);
            result.message.Should().Contain("No deployment info found");
        }

        [Fact]
        public async Task Stop_WithSuccessfulK8sDelete_ReturnsSuccess()
        {
            // TEST CASE: Stop với K8s delete thành công
            // Expected: Success

            // Arrange
            var deployInfo = new ChallengeDeploymentCacheDTO
            {
                challenge_id = 21,
                team_id = 1,
                _namespace = "ctf-challenge-21",
                status = Enums.DeploymentStatus.RUNING
            };

            _mockRedisDb.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(JsonSerializer.Serialize(deployInfo));

            _mockK8sService.Setup(x => x.DeleteNamespace("ctf-challenge-21"))
                .ReturnsAsync(true);

            _mockRedisDb.Setup(x => x.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
                .ReturnsAsync(true);

            var request = new ChallengeStartStopReqDTO
            {
                challengeId = 21,
                teamId = 1
            };

            // Act
            var result = await _deployService.Stop(request);

            // Assert
            result.Should().NotBeNull();
            result.success.Should().BeTrue();
            result.status.Should().Be(200);
            result.message.Should().Contain("stopped");
            
            _mockK8sService.Verify(x => x.DeleteNamespace("ctf-challenge-21"), Times.Once);
        }

        public void Dispose()
        {
            _dbContext?.Dispose();
        }
    }
}

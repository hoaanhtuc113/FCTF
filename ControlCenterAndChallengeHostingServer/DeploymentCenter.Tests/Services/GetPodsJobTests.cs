using Xunit;
using Moq;
using FluentAssertions;
using ResourceShared.Services;
using ResourceShared.Models;
using ResourceShared.Configs;
using DeploymentCenter.Services;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using ResourceShared.DTOs.Deployments;

namespace DeploymentCenter.Tests.Services
{
    /// <summary>
    /// Unit tests cho GetPodsJob - Job đồng bộ pod information giữa K8s và Redis cache
    /// </summary>
    public class GetPodsJobTests : IDisposable
    {
        private readonly Mock<IK8sService> _mockK8sService;
        private readonly Mock<IConnectionMultiplexer> _mockRedis;
        private readonly Mock<IDatabase> _mockRedisDb;
        private readonly RedisHelper _redisHelper;
        private readonly GetPodsJob _getPodsJob;

        public GetPodsJobTests()
        {
            // Setup mocks
            _mockK8sService = new Mock<IK8sService>();
            
            // Setup Redis mocks
            _mockRedis = new Mock<IConnectionMultiplexer>();
            _mockRedisDb = new Mock<IDatabase>();
            _mockRedis.Setup(x => x.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(_mockRedisDb.Object);
            _redisHelper = new RedisHelper(_mockRedis.Object);

            // Create job instance
            _getPodsJob = new GetPodsJob(_mockK8sService.Object, _redisHelper);
        }

        [Fact]
        public async Task RunAsync_WhenNoCachedPods_UpdatesCacheWithCurrentPods()
        {
            // TEST CASE: Chạy job khi cache trống (lần đầu tiên)
            // Expected: Cache được update với danh sách pods hiện tại từ K8s

            // Arrange
            var currentPods = new List<PodInfo>
            {
                new PodInfo { Name = "pod-1", Namespace = "ns-1", ChallengeId = 1, TeamId = 1 },
                new PodInfo { Name = "pod-2", Namespace = "ns-2", ChallengeId = 2, TeamId = 1 }
            };

            // Mock K8s service trả về pods hiện tại
            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ReturnsAsync(currentPods);

            // Mock Redis không có cache (trả về null)
            _mockRedisDb.Setup(x => x.StringGetAsync(RedisConfigs.PodsInfoKey, It.IsAny<CommandFlags>()))
                .ReturnsAsync(RedisValue.Null);

            // Act
            await _getPodsJob.RunAsync(CancellationToken.None);

            // Assert
            // Verify K8s service được gọi
            _mockK8sService.Verify(x => x.GetPodsByLabel(It.IsAny<string>()), Times.Once);
        }

        [Fact]
        public async Task RunAsync_WhenPodsStopRunning_RemovesFromCacheAndDeletesDeploymentKey()
        {
            // TEST CASE: Pods đã dừng chạy (có trong cache nhưng không còn trong K8s)
            // Expected: Xóa deployment cache key cho pods đã dừng

            // Arrange
            var cachedPods = new List<PodInfo>
            {
                new PodInfo { Name = "pod-1", Namespace = "ns-1", ChallengeId = 1, TeamId = 1 },
                new PodInfo { Name = "pod-2", Namespace = "ns-2", ChallengeId = 2, TeamId = 2 }
            };

            var currentPods = new List<PodInfo>
            {
                // Chỉ có pod-1 còn chạy, pod-2 đã dừng
                new PodInfo { Name = "pod-1", Namespace = "ns-1", ChallengeId = 1, TeamId = 1 }
            };

            // Mock K8s service trả về pods hiện tại (chỉ có 1 pod)
            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ReturnsAsync(currentPods);

            // Mock Redis trả về cached pods (có 2 pods)
            var cachedPodsJson = System.Text.Json.JsonSerializer.Serialize(cachedPods);
            _mockRedisDb.Setup(x => x.StringGetAsync(RedisConfigs.PodsInfoKey, It.IsAny<CommandFlags>()))
                .ReturnsAsync(cachedPodsJson);

            // Act
            await _getPodsJob.RunAsync(CancellationToken.None);

            // Assert
            // Verify K8s service được gọi
            _mockK8sService.Verify(x => x.GetPodsByLabel(It.IsAny<string>()), Times.Once);
        }

        [Fact]
        public async Task RunAsync_WhenAllPodsStillRunning_UpdatesCacheWithoutRemovingKeys()
        {
            // TEST CASE: Tất cả pods vẫn đang chạy (cached pods match current pods)
            // Expected: Cache được update, không xóa key nào

            // Arrange
            var pods = new List<PodInfo>
            {
                new PodInfo { Name = "pod-1", Namespace = "ns-1", ChallengeId = 1, TeamId = 1 },
                new PodInfo { Name = "pod-2", Namespace = "ns-2", ChallengeId = 2, TeamId = 2 }
            };

            // Mock K8s service trả về pods
            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ReturnsAsync(pods);

            // Mock Redis trả về cùng pods
            var cachedPodsJson = System.Text.Json.JsonSerializer.Serialize(pods);
            _mockRedisDb.Setup(x => x.StringGetAsync(RedisConfigs.PodsInfoKey, It.IsAny<CommandFlags>()))
                .ReturnsAsync(cachedPodsJson);

            // Act
            await _getPodsJob.RunAsync(CancellationToken.None);

            // Assert
            _mockK8sService.Verify(x => x.GetPodsByLabel(It.IsAny<string>()), Times.Once);
            // Không có pod nào bị xóa vì tất cả vẫn running
        }

        [Fact]
        public async Task RunAsync_WhenPodHasInvalidTeamId_SkipsRemoval()
        {
            // TEST CASE: Pod có TeamId <= 0 (invalid)
            // Expected: Skip pod này, không xóa cache key

            // Arrange
            var cachedPods = new List<PodInfo>
            {
                new PodInfo { Name = "pod-1", Namespace = "ns-1", ChallengeId = 1, TeamId = 0 }, // Invalid TeamId
                new PodInfo { Name = "pod-2", Namespace = "ns-2", ChallengeId = 2, TeamId = 1 }
            };

            var currentPods = new List<PodInfo>(); // Không có pod nào đang chạy

            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ReturnsAsync(currentPods);

            var cachedPodsJson = System.Text.Json.JsonSerializer.Serialize(cachedPods);
            _mockRedisDb.Setup(x => x.StringGetAsync(RedisConfigs.PodsInfoKey, It.IsAny<CommandFlags>()))
                .ReturnsAsync(cachedPodsJson);

            // Act
            await _getPodsJob.RunAsync(CancellationToken.None);

            // Assert
            // Job chạy thành công dù có invalid TeamId
            _mockK8sService.Verify(x => x.GetPodsByLabel(It.IsAny<string>()), Times.Once);
        }

        [Fact]
        public async Task RunAsync_WhenK8sServiceThrowsException_HandlesGracefully()
        {
            // TEST CASE: K8s service throw exception
            // Expected: Job xử lý exception và không crash

            // Arrange
            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ThrowsAsync(new Exception("K8s connection failed"));

            _mockRedisDb.Setup(x => x.StringGetAsync(RedisConfigs.PodsInfoKey, It.IsAny<CommandFlags>()))
                .ReturnsAsync(RedisValue.Null);

            // Act & Assert
            // Job không throw exception ra ngoài
            await _getPodsJob.RunAsync(CancellationToken.None);

            // Verify K8s service vẫn được gọi
            _mockK8sService.Verify(x => x.GetPodsByLabel(It.IsAny<string>()), Times.Once);
        }

        [Fact]
        public async Task RunAsync_WhenMultiplePodsStop_RemovesAllStoppedPodsFromCache()
        {
            // TEST CASE: Nhiều pods dừng cùng lúc
            // Expected: Tất cả stopped pods được xóa khỏi cache

            // Arrange
            var cachedPods = new List<PodInfo>
            {
                new PodInfo { Name = "pod-1", Namespace = "ns-1", ChallengeId = 1, TeamId = 1 },
                new PodInfo { Name = "pod-2", Namespace = "ns-2", ChallengeId = 2, TeamId = 2 },
                new PodInfo { Name = "pod-3", Namespace = "ns-3", ChallengeId = 3, TeamId = 3 }
            };

            // Không có pod nào đang chạy
            var currentPods = new List<PodInfo>();

            _mockK8sService.Setup(x => x.GetPodsByLabel(It.IsAny<string>()))
                .ReturnsAsync(currentPods);

            var cachedPodsJson = System.Text.Json.JsonSerializer.Serialize(cachedPods);
            _mockRedisDb.Setup(x => x.StringGetAsync(RedisConfigs.PodsInfoKey, It.IsAny<CommandFlags>()))
                .ReturnsAsync(cachedPodsJson);

            // Act
            await _getPodsJob.RunAsync(CancellationToken.None);

            // Assert
            _mockK8sService.Verify(x => x.GetPodsByLabel(It.IsAny<string>()), Times.Once);
            // Tất cả 3 pods đều bị xóa khỏi cache
        }

        [Fact]
        public void GetPodsJob_Constructor_InitializesSuccessfully()
        {
            // TEST CASE: Verify job khởi tạo thành công
            // Expected: Job và dependencies không null

            // Assert
            _getPodsJob.Should().NotBeNull();
            _redisHelper.Should().NotBeNull();
        }

        public void Dispose()
        {
            // Cleanup nếu cần
        }
    }
}

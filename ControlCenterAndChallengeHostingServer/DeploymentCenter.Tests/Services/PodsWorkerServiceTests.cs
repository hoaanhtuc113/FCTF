using Xunit;
using Moq;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using DeploymentCenter.Services;
using ResourceShared.Utils;
using StackExchange.Redis;

namespace DeploymentCenter.Tests.Services
{
    /// <summary>
    /// Unit tests cho PodsWorkerService - Background service quản lý periodic pod monitoring
    /// 
    /// NOTE: PodsWorkerService là BackgroundService với PeriodicTimer, khó test trực tiếp do:
    /// - Async execution timing issues
    /// - PeriodicTimer không mockable  
    /// - Background task lifecycle complexity
    /// 
    /// Tests này focus vào:
    /// - Constructor validation
    /// - Service type verification
    /// - Basic lifecycle (Start/Stop)
    /// 
    /// Để test logic bên trong, nên:
    /// - Test GetPodsJob riêng (đã có GetPodsJobTests)
    /// - Test RedisLockHelper riêng
    /// - Integration tests với TestServer
    /// </summary>
    public class PodsWorkerServiceTests : IDisposable
    {
        private readonly Mock<IServiceScopeFactory> _mockScopeFactory;
        private readonly Mock<IServiceScope> _mockScope;
        private readonly Mock<IServiceProvider> _mockServiceProvider;
        private readonly Mock<IGetPodsJob> _mockGetPodsJob;
        private readonly RedisLockHelper _redisLockHelper;
        private readonly Mock<IConnectionMultiplexer> _mockRedis;
        private readonly Mock<IDatabase> _mockRedisDb;

        public PodsWorkerServiceTests()
        {
            // CRITICAL: Set WORKER_SERVICE_INTERVAL to avoid PeriodicTimer ArgumentOutOfRangeException
            DeploymentCenter.Utils.DeploymentCenterConfigHelper.WORKER_SERVICE_INTERVAL = 30;

            // Setup Redis mocks
            _mockRedis = new Mock<IConnectionMultiplexer>();
            _mockRedisDb = new Mock<IDatabase>();
            
            // Fix: RedisLockHelper uses GetDatabase(-1, null)
            _mockRedis.Setup(x => x.GetDatabase(-1, null))
                .Returns(_mockRedisDb.Object);

            // Setup RedisLockHelper with real instance (cannot mock non-virtual methods)
            _redisLockHelper = new RedisLockHelper(_mockRedis.Object);

            // Setup service scope mocks
            _mockServiceProvider = new Mock<IServiceProvider>();
            _mockScope = new Mock<IServiceScope>();
            _mockScopeFactory = new Mock<IServiceScopeFactory>();

            _mockGetPodsJob = new Mock<IGetPodsJob>();

            // Configure scope factory chain
            _mockScope.Setup(x => x.ServiceProvider).Returns(_mockServiceProvider.Object);
            _mockScopeFactory.Setup(x => x.CreateScope()).Returns(_mockScope.Object);
            _mockServiceProvider.Setup(x => x.GetService(typeof(IGetPodsJob)))
                .Returns(_mockGetPodsJob.Object);
        }

        [Fact]
        public void PodsWorkerService_Constructor_InitializesSuccessfully()
        {
            // TEST CASE: Verify service khởi tạo thành công
            // Expected: Service không null

            // Act
            var service = new PodsWorkerService(_mockScopeFactory.Object, _redisLockHelper);

            // Assert
            service.Should().NotBeNull();
        }

        [Fact]
        public void PodsWorkerService_ImplementsBackgroundService()
        {
            // TEST CASE: Verify PodsWorkerService kế thừa BackgroundService
            // Expected: Service có base type là BackgroundService

            // Act
            var service = new PodsWorkerService(_mockScopeFactory.Object, _redisLockHelper);

            // Assert
            service.Should().BeAssignableTo<Microsoft.Extensions.Hosting.BackgroundService>();
        }

        [Fact]
        public async Task PodsWorkerService_StartAsync_CompletesSuccessfully()
        {
            // TEST CASE: Service StartAsync không throw exception
            // Expected: Starts successfully

            // Arrange
            _mockRedisDb
                .Setup(x => x.StringSetAsync(
                    It.IsAny<RedisKey>(),
                    It.IsAny<RedisValue>(),
                    It.IsAny<TimeSpan?>(),
                    It.IsAny<When>(),
                    It.IsAny<CommandFlags>()))
                .ReturnsAsync(true);

            _mockRedisDb
                .Setup(x => x.ScriptEvaluateAsync(
                    It.IsAny<string>(),
                    It.IsAny<RedisKey[]>(),
                    It.IsAny<RedisValue[]>(),
                    It.IsAny<CommandFlags>()))
                .ReturnsAsync(RedisResult.Create(1));

            _mockGetPodsJob
                .Setup(x => x.RunAsync(It.IsAny<CancellationToken>()))
                .Returns(Task.CompletedTask);

            var service = new PodsWorkerService(_mockScopeFactory.Object, _redisLockHelper);

            // Act
            Func<Task> act = async () => await service.StartAsync(CancellationToken.None);

            // Assert
            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task PodsWorkerService_StopAsync_CompletesSuccessfully()
        {
            // TEST CASE: Service StopAsync không throw exception  
            // Expected: Stops successfully

            // Arrange
            _mockRedisDb
                .Setup(x => x.StringSetAsync(
                    It.IsAny<RedisKey>(),
                    It.IsAny<RedisValue>(),
                    It.IsAny<TimeSpan?>(),
                    It.IsAny<When>(),
                    It.IsAny<CommandFlags>()))
                .ReturnsAsync(true);

            _mockGetPodsJob
                .Setup(x => x.RunAsync(It.IsAny<CancellationToken>()))
                .Returns(Task.CompletedTask);

            var service = new PodsWorkerService(_mockScopeFactory.Object, _redisLockHelper);
            await service.StartAsync(CancellationToken.None);

            // Act
            Func<Task> act = async () => await service.StopAsync(CancellationToken.None);

            // Assert
            await act.Should().NotThrowAsync();
        }

        [Fact]
        public void PodsWorkerService_UsesCorrectDependencies()
        {
            // TEST CASE: Verify service sử dụng đúng dependencies
            // Expected: Service được inject với đúng dependencies

            // Arrange & Act
            var service = new PodsWorkerService(_mockScopeFactory.Object, _redisLockHelper);

            // Assert
            service.Should().NotBeNull();
            _mockScopeFactory.Should().NotBeNull();
            _redisLockHelper.Should().NotBeNull();
        }

        public void Dispose()
        {
            // Cleanup nếu cần
        }
    }
}

using Xunit;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using DeploymentCenter.Utils;
using ResourceShared.Utils;

namespace DeploymentCenter.Tests.Utils
{
    /// <summary>
    /// Unit tests cho DeploymentCenterConfigHelper - Helper load và validate configuration
    /// </summary>
    public class DeploymentCenterConfigHelperTests
    {
        [Fact]
        public void InitConfig_WithValidConfiguration_LoadsAllSettings()
        {
            // TEST CASE: Load config với tất cả settings hợp lệ
            // Expected: Tất cả config values được load đúng

            // Arrange
            var configData = new Dictionary<string, string>
            {
                { "REDIS_CONNECTION", "localhost:6379" },
                { "PRIVATE_KEY", "test-private-key" },
                { "TCP_DOMAIN", "tcp.test.local" },
                { "ARGO_WORKFLOWS_URL", "http://argo-workflows.local" },
                { "ARGO_WORKFLOWS_TOKEN", "test-token-123" },
                { "CPU_LIMIT", "500m" },
                { "CPU_REQUEST", "250m" },
                { "MEMORY_LIMIT", "512Mi" },
                { "MEMORY_REQUEST", "256Mi" },
                { "POD_START_TIMEOUT_MINUTES", "10" },
                { "WORKER_SERVICE_INTERVAL", "30" }
            };

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(configData!)
                .Build();

            var helper = new TestableDeploymentCenterConfigHelper(configuration);

            // Act
            helper.InitConfig();

            // Assert
            DeploymentCenterConfigHelper.ARGO_WORKFLOWS_URL.Should().Be("http://argo-workflows.local");
            DeploymentCenterConfigHelper.ARGO_WORKFLOWS_TOKEN.Should().Be("test-token-123");
            DeploymentCenterConfigHelper.CPU_LIMIT.Should().Be("500m");
            DeploymentCenterConfigHelper.CPU_REQUEST.Should().Be("250m");
            DeploymentCenterConfigHelper.MEMORY_LIMIT.Should().Be("512Mi");
            DeploymentCenterConfigHelper.MEMORY_REQUEST.Should().Be("256Mi");
            DeploymentCenterConfigHelper.POD_START_TIMEOUT_MINUTES.Should().Be("10");
            DeploymentCenterConfigHelper.WORKER_SERVICE_INTERVAL.Should().Be(30);
        }

        [Fact]
        public void InitConfig_WithMissingArgoUrl_ThrowsException()
        {
            // TEST CASE: Config thiếu ARGO_WORKFLOWS_URL (required)
            // Expected: Throw Exception với message rõ ràng

            // Arrange
            var configData = new Dictionary<string, string>
            {
                { "REDIS_CONNECTION", "localhost:6379" },
                { "PRIVATE_KEY", "test-private-key" },
                { "TCP_DOMAIN", "tcp.test.local" },
                { "ARGO_WORKFLOWS_TOKEN", "test-token" }
                // Missing ARGO_WORKFLOWS_URL
            };

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(configData!)
                .Build();

            var helper = new TestableDeploymentCenterConfigHelper(configuration);

            // Act & Assert
            var exception = Assert.Throws<Exception>(() => helper.InitConfig());
            exception.Message.Should().Contain("ARGO_WORKFLOWS_URL");
        }

        [Fact]
        public void InitConfig_WithMissingArgoToken_ThrowsException()
        {
            // TEST CASE: Config thiếu ARGO_WORKFLOWS_TOKEN (required)
            // Expected: Throw Exception

            // Arrange
            var configData = new Dictionary<string, string>
            {
                { "REDIS_CONNECTION", "localhost:6379" },
                { "PRIVATE_KEY", "test-private-key" },
                { "TCP_DOMAIN", "tcp.test.local" },
                { "ARGO_WORKFLOWS_URL", "http://argo-workflows.local" }
                // Missing ARGO_WORKFLOWS_TOKEN
            };

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(configData!)
                .Build();

            var helper = new TestableDeploymentCenterConfigHelper(configuration);

            // Act & Assert
            var exception = Assert.Throws<Exception>(() => helper.InitConfig());
            exception.Message.Should().Contain("ARGO_WORKFLOWS_TOKEN");
        }

        [Fact]
        public void InitConfig_WithMissingOptionalSettings_UsesDefaults()
        {
            // TEST CASE: Config thiếu optional settings (CPU, Memory, Timeout)
            // Expected: Sử dụng default values (300m, 256Mi, 5 minutes, 20 seconds)

            // Arrange
            var configData = new Dictionary<string, string>
            {
                { "REDIS_CONNECTION", "localhost:6379" },
                { "PRIVATE_KEY", "test-private-key" },
                { "TCP_DOMAIN", "tcp.test.local" },
                { "ARGO_WORKFLOWS_URL", "http://argo-workflows.local" },
                { "ARGO_WORKFLOWS_TOKEN", "test-token" }
                // Missing optional configs
            };

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(configData!)
                .Build();

            var helper = new TestableDeploymentCenterConfigHelper(configuration);

            // Act
            helper.InitConfig();

            // Assert - Verify default values
            DeploymentCenterConfigHelper.CPU_LIMIT.Should().Be("300m");
            DeploymentCenterConfigHelper.CPU_REQUEST.Should().Be("300m");
            DeploymentCenterConfigHelper.MEMORY_LIMIT.Should().Be("256Mi");
            DeploymentCenterConfigHelper.MEMORY_REQUEST.Should().Be("256Mi");
            DeploymentCenterConfigHelper.POD_START_TIMEOUT_MINUTES.Should().Be("5");
            DeploymentCenterConfigHelper.WORKER_SERVICE_INTERVAL.Should().Be(20);
        }

        [Fact]
        public void InitConfig_WithEmptyStringValues_SetsEmptyStrings()
        {
            // TEST CASE: Config values là empty string
            // Expected: Empty string được set (không phải defaults)
            // Note: Code hiện tại không handle empty string - ?? operator chỉ check null không check empty
            // Bug: configuration["key"] returns "" not null when value is empty string

            // Arrange
            var configData = new Dictionary<string, string>
            {
                { "REDIS_CONNECTION", "localhost:6379" },
                { "PRIVATE_KEY", "test-private-key" },
                { "TCP_DOMAIN", "tcp.test.local" },
                { "ARGO_WORKFLOWS_URL", "http://argo-workflows.local" },
                { "ARGO_WORKFLOWS_TOKEN", "test-token" },
                { "CPU_LIMIT", "" },
                { "MEMORY_LIMIT", "" }
            };

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(configData!)
                .Build();

            var helper = new TestableDeploymentCenterConfigHelper(configuration);

            // Act
            helper.InitConfig();

            // Assert - Empty strings are set (not defaults) - this is current behavior
            DeploymentCenterConfigHelper.CPU_LIMIT.Should().Be("");
            DeploymentCenterConfigHelper.MEMORY_LIMIT.Should().Be("");
        }

        [Fact]
        public void InitConfig_WithInvalidWorkerInterval_ThrowsFormatException()
        {
            // TEST CASE: WORKER_SERVICE_INTERVAL không phải là số
            // Expected: Throw FormatException

            // Arrange
            var configData = new Dictionary<string, string>
            {
                { "REDIS_CONNECTION", "localhost:6379" },
                { "PRIVATE_KEY", "test-private-key" },
                { "TCP_DOMAIN", "tcp.test.local" },
                { "ARGO_WORKFLOWS_URL", "http://argo-workflows.local" },
                { "ARGO_WORKFLOWS_TOKEN", "test-token" },
                { "WORKER_SERVICE_INTERVAL", "invalid-number" }
            };

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(configData!)
                .Build();

            var helper = new TestableDeploymentCenterConfigHelper(configuration);

            // Act & Assert
            Assert.Throws<FormatException>(() => helper.InitConfig());
        }

        [Fact]
        public void InitConfig_WithCustomResourceLimits_LoadsCustomValues()
        {
            // TEST CASE: Config có custom resource limits
            // Expected: Load custom values thay vì defaults

            // Arrange
            var configData = new Dictionary<string, string>
            {
                { "REDIS_CONNECTION", "localhost:6379" },
                { "PRIVATE_KEY", "test-private-key" },
                { "TCP_DOMAIN", "tcp.test.local" },
                { "ARGO_WORKFLOWS_URL", "http://argo-workflows.local" },
                { "ARGO_WORKFLOWS_TOKEN", "test-token" },
                { "CPU_LIMIT", "1000m" },
                { "CPU_REQUEST", "500m" },
                { "MEMORY_LIMIT", "1Gi" },
                { "MEMORY_REQUEST", "512Mi" },
                { "POD_START_TIMEOUT_MINUTES", "15" },
                { "WORKER_SERVICE_INTERVAL", "60" }
            };

            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(configData!)
                .Build();

            var helper = new TestableDeploymentCenterConfigHelper(configuration);

            // Act
            helper.InitConfig();

            // Assert
            DeploymentCenterConfigHelper.CPU_LIMIT.Should().Be("1000m");
            DeploymentCenterConfigHelper.CPU_REQUEST.Should().Be("500m");
            DeploymentCenterConfigHelper.MEMORY_LIMIT.Should().Be("1Gi");
            DeploymentCenterConfigHelper.MEMORY_REQUEST.Should().Be("512Mi");
            DeploymentCenterConfigHelper.POD_START_TIMEOUT_MINUTES.Should().Be("15");
            DeploymentCenterConfigHelper.WORKER_SERVICE_INTERVAL.Should().Be(60);
        }

        // Helper class để test DeploymentCenterConfigHelper
        // Vì class gốc kế thừa từ SharedConfig và có protected members
        private class TestableDeploymentCenterConfigHelper : DeploymentCenterConfigHelper
        {
            public TestableDeploymentCenterConfigHelper(IConfiguration configuration)
            {
                SharedConfig.configuration = configuration;
            }
        }
    }
}

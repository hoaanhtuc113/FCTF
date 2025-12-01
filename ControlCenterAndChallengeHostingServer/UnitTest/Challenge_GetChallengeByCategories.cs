using ContestantBE.Services;
using Moq;
using ResourceShared.Models;
using ResourceShared.Utils;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using Xunit;

namespace UnitTest
{
    /// <summary>
    /// Unit test CHỈ tập trung vào VALIDATION / INPUT cho hàm:
    /// Task<List<ChallengeByCategoryDTO>> GetChallengeByCategories(string category_name, int? team_id)
    /// 
    /// Không test business logic (solved, pod_status, requirements...),
    /// chỉ xem service phản ứng thế nào với tham số "lạ" / không chuẩn.
    /// </summary>
    public class Challenge_GetChallengeByCategories : TestBase
    {
        private ChallengeServices CreateService(AppDbContext ctx)
        {
            // HttpClientFactory không dùng trong hàm này → mock rỗng
            var httpFactory = new Mock<IHttpClientFactory>().Object;

            // Tạo IConnectionMultiplexer giả cho RedisHelper
            var connMock = new Mock<IConnectionMultiplexer>();
            var dbMock = new Mock<IDatabase>();

            // Khi RedisHelper gọi GetDatabase() → trả về dbMock
            connMock
                .Setup(c => c.GetDatabase(It.IsAny<int>(), It.IsAny<object?>()))
                .Returns(dbMock.Object);

            // Không setup StringGetAsync → mặc định trả RedisValue.Null
            var redisHelper = new RedisHelper(connMock.Object);

            // ConfigHelper không dùng trong hàm này
            ConfigHelper configHelper = null!;

            return new ChallengeServices(
                httpFactory: httpFactory,
                dbContext: ctx,
                redisHelper: redisHelper,
                configHelper: configHelper);
        }

        // ============================================
        // 1️⃣ category_name = null  → không exception, trả về list rỗng
        // ============================================
        [Fact]
        public async Task TC01_CategoryNull_ReturnsEmptyList_NoException()
        {
            using var ctx = CreateContext(nameof(TC01_CategoryNull_ReturnsEmptyList_NoException));

            // Seed 1 challenge với category "web"
            ctx.Challenges.Add(new Challenge
            {
                Id = 1,
                Name = "Web 1",
                Category = "web",
                State = "active"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetChallengeByCategories(category_name: null!, team_id: 10);

            Assert.NotNull(result);
            Assert.Empty(result); // Không có challenge nào Category = null
        }

        // ============================================
        // 2️⃣ category_name = "" (empty) → không exception, trả list rỗng
        // ============================================
        [Fact]
        public async Task TC02_CategoryEmpty_ReturnsEmptyList_NoException()
        {
            using var ctx = CreateContext(nameof(TC02_CategoryEmpty_ReturnsEmptyList_NoException));

            ctx.Challenges.Add(new Challenge
            {
                Id = 2,
                Name = "Web 2",
                Category = "web",
                State = "active"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetChallengeByCategories(category_name: string.Empty, team_id: 10);

            Assert.NotNull(result);
            Assert.Empty(result); // Không có challenge nào Category = ""
        }

        // ============================================
        // 3️⃣ category_name = "   " (toàn space) → không exception, trả list rỗng
        // ============================================
        [Fact]
        public async Task TC03_CategoryWhitespace_ReturnsEmptyList_NoException()
        {
            using var ctx = CreateContext(nameof(TC03_CategoryWhitespace_ReturnsEmptyList_NoException));

            ctx.Challenges.Add(new Challenge
            {
                Id = 3,
                Name = "Web 3",
                Category = "web",
                State = "active"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetChallengeByCategories(category_name: "   ", team_id: 10);

            Assert.NotNull(result);
            Assert.Empty(result); // Không có challenge nào Category = "   "
        }

        // ============================================
        // 4️⃣ team_id = null → hiện tại NÉM InvalidOperationException
        //     (do dùng team_id.Value trong GetCacheKey)
        // ============================================
        [Fact]
        public async Task TC04_TeamIdNull_ThrowsInvalidOperationException()
        {
            using var ctx = CreateContext(nameof(TC04_TeamIdNull_ThrowsInvalidOperationException));

            // Seed ít nhất 1 challenge để vào vòng foreach
            ctx.Challenges.Add(new Challenge
            {
                Id = 4,
                Name = "Web 4",
                Category = "web",
                State = "active",
                RequireDeploy = false
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            {
                await service.GetChallengeByCategories(category_name: "web", team_id: null);
            });

            Assert.Contains("Nullable object must have a value", ex.Message);
        }

        // ============================================
        // 5️⃣ team_id = 0 → KHÔNG exception, hàm xử lý bình thường (trả list)
        // ============================================
        [Fact]
        public async Task TC05_TeamIdZero_NoException()
        {
            using var ctx = CreateContext(nameof(TC05_TeamIdZero_NoException));

            ctx.Challenges.Add(new Challenge
            {
                Id = 5,
                Name = "Web 5",
                Category = "web",
                State = "active",
                RequireDeploy = false
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetChallengeByCategories(category_name: "web", team_id: 0);

            Assert.NotNull(result);
            Assert.Single(result); // Có 1 challenge "web" được trả về
        }

        // ============================================
        // 6️⃣ team_id < 0 → KHÔNG exception, hàm xử lý bình thường (trả list)
        // ============================================
        [Fact]
        public async Task TC06_TeamIdNegative_NoException()
        {
            using var ctx = CreateContext(nameof(TC06_TeamIdNegative_NoException));

            ctx.Challenges.Add(new Challenge
            {
                Id = 6,
                Name = "Web 6",
                Category = "web",
                State = "active",
                RequireDeploy = false
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetChallengeByCategories(category_name: "web", team_id: -5);

            Assert.NotNull(result);
            Assert.Single(result);   // Có 1 challenge "web" được trả về
        }

        // ============================================
        // 7️⃣ Requirements JSON lỗi → KHÔNG exception, requirements = null
        // ============================================
        [Fact]
        public async Task TC07_InvalidRequirementsJson_NoException_RequirementsNull()
        {
            using var ctx = CreateContext(nameof(TC07_InvalidRequirementsJson_NoException_RequirementsNull));

            ctx.Challenges.Add(new Challenge
            {
                Id = 7,
                Name = "Web 7",
                Category = "web",
                State = "active",
                RequireDeploy = false,
                Requirements = "this is not json"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetChallengeByCategories(category_name: "web", team_id: 10);

            Assert.Single(result);
            Assert.Null(result[0].requirements); // Parse lỗi → requirements = null
        }

        // ============================================
        // 8️⃣ RequireDeploy = true + cache null → KHÔNG exception, pod_status = null
        //      (validation cho việc thiếu cache)
        // ============================================
        [Fact]
        public async Task TC08_RequireDeployTrue_CacheNull_NoException_PodStatusNull()
        {
            using var ctx = CreateContext(nameof(TC08_RequireDeployTrue_CacheNull_NoException_PodStatusNull));

            ctx.Challenges.Add(new Challenge
            {
                Id = 8,
                Name = "Web 8",
                Category = "web",
                State = "active",
                RequireDeploy = true,   // cần deploy
                Requirements = null
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetChallengeByCategories(category_name: "web", team_id: 10);

            Assert.Single(result);
            Assert.Null(result[0].pod_status);  // cache null → pod_status null, không crash
        }
    }
}

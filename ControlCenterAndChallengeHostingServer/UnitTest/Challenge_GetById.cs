using ContestantBE.Services;
using Moq;
using ResourceShared.Models;
using SocialSync.Shared.Utils.ResourceShared.Utils; // RedisHelper
using ResourceShared.Utils;                         // ConfigHelper
using StackExchange.Redis;
using System.Net;
using Xunit;

namespace UnitTest
{
    public class Challenge_GetById : TestBase
    {
        private static User MakeUser(int id, int teamId) => new User
        {
            Id = id,
            Name = $"user_{id}",
            TeamId = teamId,
            Team = new Team
            {
                Id = teamId,
                CaptainId = id
            }
        };

        // Helper tạo mock Redis & Config cho các case cần đi sâu logic
        private (RedisHelper redis, ConfigHelper config) CreateInfraMocks()
        {
            // RedisHelper cần IConnectionMultiplexer
            var redisConnMock = new Mock<IConnectionMultiplexer>();
            var redisMock = new Mock<RedisHelper>(redisConnMock.Object);

            // Đảm bảo không vào nhánh cache (KeyExistsAsync = false)
            redisMock
                .Setup(r => r.KeyExistsAsync(It.IsAny<string>()))
                .ReturnsAsync(false);

            // ConfigHelper: captain_only_* trả về true (hoặc gì cũng được)
            var configMock = new Mock<ConfigHelper>();
            configMock
                .Setup(c => c.GetConfig<bool>("captain_only_start_challenge", true))
                .Returns(true);
            configMock
                .Setup(c => c.GetConfig<bool>("captain_only_submit_challenge", true))
                .Returns(true);

            return (redisMock.Object, configMock.Object);
        }

        // ===============================
        // 1️⃣ Challenge NOT FOUND
        // ===============================
        [Fact]
        public async Task TC01_Challenge_NotFound()
        {
            using var ctx = CreateContext(nameof(TC01_Challenge_NotFound));

            // Không seed challenge nào có Id = 999
            var user = MakeUser(1, 10);

            var service = new ChallengeServices(
                httpFactory: null!,
                dbContext: ctx,
                redisHelper: null!,      // an toàn vì return sớm
                configHelper: null!);    // an toàn vì return sớm

            var res = await service.GetById(999, user);

            Assert.Equal(HttpStatusCode.NotFound, res.HttpStatusCode);
            Assert.Equal("Challenge not found", res.Message);
            Assert.Null(res.Data);
        }

        // ===============================
        // 2️⃣ Challenge HIDDEN
        // ===============================
        [Fact]
        public async Task TC02_Challenge_Hidden()
        {
            using var ctx = CreateContext(nameof(TC02_Challenge_Hidden));

            // Seed 1 challenge ở trạng thái hidden
            ctx.Challenges.Add(new Challenge
            {
                Id = 5,
                Name = "Hidden Challenge",
                Category = "Web",
                State = "hidden",
                RequireDeploy = false
            });
            await ctx.SaveChangesAsync();

            var user = MakeUser(1, 10);

            var service = new ChallengeServices(
                httpFactory: null!,
                dbContext: ctx,
                redisHelper: null!,      // return sớm
                configHelper: null!);    // return sớm

            var res = await service.GetById(5, user);

            Assert.Equal(HttpStatusCode.NotFound, res.HttpStatusCode);
            Assert.Equal("Challenge now is not available", res.Message);
            Assert.Null(res.Data);
        }

        // ===============================
        // 3️⃣ challengeId <= 0 → hiện tại cũng bị xử lý như NOT FOUND
        //     (fail case về input id, nhưng system gom chung NotFound)
        // ===============================
        [Fact]
        public async Task TC03_ChallengeId_LessOrEqualZero_TreatedAsNotFound()
        {
            using var ctx = CreateContext(nameof(TC03_ChallengeId_LessOrEqualZero_TreatedAsNotFound));

            // Không seed challenge Id = 0
            var user = MakeUser(1, 10);

            var service = new ChallengeServices(
                httpFactory: null!,
                dbContext: ctx,
                redisHelper: null!,      // challenge == null → return sớm
                configHelper: null!);    // nên không đụng tới

            var res = await service.GetById(0, user);

            Assert.Equal(HttpStatusCode.NotFound, res.HttpStatusCode);
            Assert.Equal("Challenge not found", res.Message);
            Assert.Null(res.Data);
        }

        // ===============================
        // 4️⃣ user.Team = null → hiện tại sẽ NÉM LỖI (NullReferenceException)
        //     Đây chính là FAIL CASE liên quan tới team
        // ===============================
        [Fact]
        public async Task TC04_UserTeamNull_ThrowsNullReferenceException()
        {
            using var ctx = CreateContext(nameof(TC04_UserTeamNull_ThrowsNullReferenceException));

            // Seed 1 challenge hợp lệ (không hidden) để đi sâu vào logic
            ctx.Challenges.Add(new Challenge
            {
                Id = 10,
                Name = "Normal Challenge",
                Category = "Web",
                State = "active",
                RequireDeploy = false
            });
            await ctx.SaveChangesAsync();

            // user có TeamId nhưng Team = null (đây là fail case)
            var user = new User
            {
                Id = 1,
                Name = "user_1",
                TeamId = 10,
                Team = null!    // 👈 cố tình cho null để nó crash
            };

            var service = new ChallengeServices(
                httpFactory: null!,
                dbContext: ctx,
                redisHelper: null!,      // 👈 không dùng tới vì crash trước redis
                configHelper: null!);    // 👈 cũng không dùng tới

            await Assert.ThrowsAsync<NullReferenceException>(async () =>
            {
                await service.GetById(10, user);
            });
        }

        // ===============================
        // 5️⃣ user = null → hiện tại sẽ NÉM LỖI (NullReferenceException)
        //     Đây cũng là 1 FAIL CASE về input user
        // ===============================
        [Fact]
        public async Task TC05_UserNull_ThrowsInvalidOperationException_WithInnerNullReference()
        {
            using var ctx = CreateContext(nameof(TC05_UserNull_ThrowsInvalidOperationException_WithInnerNullReference));

            ctx.Challenges.Add(new Challenge
            {
                Id = 20,
                Name = "Normal Challenge",
                Category = "Web",
                State = "active",
                RequireDeploy = false
            });
            await ctx.SaveChangesAsync();

            User? user = null;

            var service = new ChallengeServices(
                httpFactory: null!,
                dbContext: ctx,
                redisHelper: null!,
                configHelper: null!);

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            {
                await service.GetById(20, user!);
            });

            // Nếu muốn ghi rõ bug cho report: inner là NullReferenceException
            Assert.IsType<NullReferenceException>(ex.InnerException);
        }

    }
}

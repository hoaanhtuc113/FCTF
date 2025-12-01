using ContestantBE.Services;
using ResourceShared.Models;
using Xunit;

namespace UnitTest
{
    /// <summary>
    /// Unit test CHỈ tập trung vào validation / input cho hàm:
    /// Task<List<TopicDTO>> GetTopic(User user)
    ///
    /// Gồm:
    /// - Happy case (Normal)
    /// - Abnormal case (input xấu)
    /// - Boundary case (giá trị biên)
    ///
    /// Không test sâu business (đếm solved chính xác...), chỉ kiểm tra
    /// hàm xử lý input & trạng thái DB “lạ” mà không crash (trừ case mong đợi exception).
    /// </summary>
    public class Challenge_GetTopic : TestBase
    {
        private ChallengeServices CreateService(AppDbContext ctx)
        {
            // GetTopic không dùng httpFactory / redisHelper / configHelper
            return new ChallengeServices(
                httpFactory: null!,
                dbContext: ctx,
                redisHelper: null!,
                configHelper: null!);
        }

        private User MakeUser(int id, int? teamId, bool withTeam = true)
        {
            return new User
            {
                Id = id,
                Name = $"user_{id}",
                TeamId = teamId,
                Team = (withTeam && teamId.HasValue)
                    ? new Team { Id = teamId.Value, CaptainId = id }
                    : null
            };
        }

        // ============================
        // 1️⃣ HAPPY – có challenge, chưa solve → cleared = false
        // ============================
        [Fact]
        public async Task TC01_ValidUser_WithChallenges_NoSolves_ReturnsTopicNotCleared()
        {
            using var ctx = CreateContext(nameof(TC01_ValidUser_WithChallenges_NoSolves_ReturnsTopicNotCleared));

            ctx.Challenges.Add(new Challenge
            {
                Id = 1,
                Name = "Web 1",
                Category = "Web",
                State = "active"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var user = MakeUser(id: 1, teamId: 10);

            var res = await service.GetTopic(user);

            Assert.NotNull(res);
            Assert.Single(res);
            Assert.Equal("Web", res[0].topic_name);
            Assert.Equal(1, res[0].challenge_count);
            Assert.False(res[0].cleared); // chưa solve → chưa clear
        }

        // ============================
        // 2️⃣ HAPPY – solve hết challenge trong topic → cleared = true
        // ============================
        [Fact]
        public async Task TC02_ValidUser_SolvedAllChallengesInTopic_ClearedTrue()
        {
            using var ctx = CreateContext(nameof(TC02_ValidUser_SolvedAllChallengesInTopic_ClearedTrue));

            ctx.Challenges.AddRange(
                new Challenge
                {
                    Id = 1,
                    Name = "Web 1",
                    Category = "Web",
                    State = "active"
                },
                new Challenge
                {
                    Id = 2,
                    Name = "Web 2",
                    Category = "Web",
                    State = "active"
                }
            );

            // ⚠ Model thật là "Solf", DbSet rất có thể là "Solfs"
            ctx.Solves.AddRange(
                new Solf { Id = 1, ChallengeId = 1, TeamId = 10 },
                new Solf { Id = 2, ChallengeId = 2, TeamId = 10 }
            );

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var user = MakeUser(id: 1, teamId: 10);

            var res = await service.GetTopic(user);

            Assert.Single(res);
            Assert.Equal("Web", res[0].topic_name);
            Assert.Equal(2, res[0].challenge_count);
            Assert.True(res[0].cleared); // solve >= count
        }

        // ============================
        // 3️⃣ ABNORMAL – user = null → hiện tại ném InvalidOperationException
        // ============================
        [Fact]
        public async Task TC03_UserNull_ThrowsInvalidOperationException()
        {
            using var ctx = CreateContext(nameof(TC03_UserNull_ThrowsInvalidOperationException));

            ctx.Challenges.Add(new Challenge
            {
                Id = 1,
                Name = "Web 1",
                Category = "Web",
                State = "active"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            {
                await service.GetTopic(user: null!);
            });

            Assert.Contains("An exception was thrown while attempting to evaluate", ex.Message);
        }

        // ============================
        // 4️⃣ ABNORMAL – user.TeamId = null → không crash, không clear
        // ============================
        [Fact]
        public async Task TC04_UserTeamIdNull_NoException_TopicNotCleared()
        {
            using var ctx = CreateContext(nameof(TC04_UserTeamIdNull_NoException_TopicNotCleared));

            ctx.Challenges.Add(new Challenge
            {
                Id = 1,
                Name = "Web 1",
                Category = "Web",
                State = "active"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var user = MakeUser(id: 2, teamId: null);

            var res = await service.GetTopic(user);

            Assert.Single(res);
            Assert.Equal("Web", res[0].topic_name);
            Assert.Equal(1, res[0].challenge_count);
            Assert.False(res[0].cleared); // không có Solf.TeamId = null
        }

        // ============================
        // 5️⃣ BOUNDARY – user.Team = null nhưng TeamId có → vẫn chạy
        // ============================
        [Fact]
        public async Task TC05_UserTeamNull_NoException()
        {
            using var ctx = CreateContext(nameof(TC05_UserTeamNull_NoException));

            ctx.Challenges.Add(new Challenge
            {
                Id = 1,
                Name = "Web 1",
                Category = "Web",
                State = "active"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var user = new User
            {
                Id = 3,
                Name = "user_3",
                TeamId = 10,
                Team = null
            };

            var res = await service.GetTopic(user);

            Assert.Single(res);
            Assert.Equal("Web", res[0].topic_name);
            Assert.Equal(1, res[0].challenge_count);
        }

        // ============================
        // 6️⃣ BOUNDARY – không có challenge nào → list rỗng
        // ============================
        [Fact]
        public async Task TC06_NoChallenges_ReturnsEmptyList()
        {
            using var ctx = CreateContext(nameof(TC06_NoChallenges_ReturnsEmptyList));

            var service = CreateService(ctx);
            var user = MakeUser(id: 4, teamId: 10);

            var res = await service.GetTopic(user);

            Assert.NotNull(res);
            Assert.Empty(res);
        }

        // ============================
        // 7️⃣ BOUNDARY – TeamId = 0 → vẫn chạy, không clear
        // ============================
        [Fact]
        public async Task TC07_UserTeamIdZero_NoException_NotCleared()
        {
            using var ctx = CreateContext(nameof(TC07_UserTeamIdZero_NoException_NotCleared));

            ctx.Challenges.Add(new Challenge
            {
                Id = 1,
                Name = "Web 1",
                Category = "Web",
                State = "active"
            });
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);
            var user = MakeUser(id: 5, teamId: 0);

            var res = await service.GetTopic(user);

            Assert.Single(res);
            Assert.Equal("Web", res[0].topic_name);
            Assert.Equal(1, res[0].challenge_count);
            Assert.False(res[0].cleared);
        }
    }
}

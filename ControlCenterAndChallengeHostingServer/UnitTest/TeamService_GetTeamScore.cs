using System;
using System.Linq;
using System.Threading.Tasks;
using ContestantBE.Services;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using ResourceShared.Utils;
using Xunit;

namespace UnitTest
{
    public class TeamService_GetTeamScore : TestBase
    {
        /// <summary>
        /// Tạo DbContextOptions cho InMemory
        /// </summary>
        private DbContextOptions<AppDbContext> CreateOptions()
        {
            return new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
        }

        /// <summary>
        /// Tạo TeamService với ConfigHelper, CtfTimeHelper, ScoreHelper thật
        /// </summary>
        private TeamService CreateService(AppDbContext ctx, DbContextOptions<AppDbContext> options)
        {
            var configHelper = new ConfigHelper(ctx);
            var ctfTimeHelper = new CtfTimeHelper(configHelper);
            var scoreHelper = new ScoreHelper(options, configHelper, ctx);

            return new TeamService(
                context: ctx,
                ctfTimeHelper: ctfTimeHelper,
                configHelper: configHelper,
                scoreHelper: scoreHelper
            );
        }

        // ================== TEST CASES CHO GetTeamScore ==================

        /// <summary>
        /// User tồn tại nhưng không thuộc bất kỳ team nào -> trả về null
        /// </summary>
        [Fact]
        public async Task GetTeamScore_ReturnsNull_When_User_Has_No_Team()
        {
            var options = CreateOptions();
            using var ctx = new AppDbContext(options);

            // Seed 1 user nhưng không có team nào chứa user này
            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "UserNoTeam",
                TeamId = null
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx, options);

            var result = await svc.GetTeamScore(1);

            Assert.Null(result);
        }

        /// <summary>
        /// User thuộc 1 team, có 2 members, có challenges visible/hidden
        /// -> Trả về TeamScoreDTO với:
        /// - Name = team.Name
        /// - Place = 1 (vì chỉ có 1 team, ScoreHelper xếp hạng 1)
        /// - Members gồm cả 2 member
        /// - Score = 0 (vì không seed solves/awards)
        /// - ChallengeTotalScore = tổng value của challenges visible
        /// </summary>
        [Fact]
        public async Task GetTeamScore_Returns_TeamScoreDto_With_Correct_Data()
        {
            var options = CreateOptions();
            using var ctx = new AppDbContext(options);

            // ===== Seed team & users =====
            var team = new Team
            {
                Id = 10,
                Name = "TeamA",
                Hidden = false,
                Banned = false
            };
            ctx.Teams.Add(team);

            var user1 = new User
            {
                Id = 1,
                Name = "Alice",
                Email = "alice@example.com",
                TeamId = team.Id
            };
            var user2 = new User
            {
                Id = 2,
                Name = "Bob",
                Email = "bob@example.com",
                TeamId = team.Id
            };

            ctx.Users.AddRange(user1, user2);

            // ===== Seed challenges =====
            ctx.Challenges.Add(new Challenge
            {
                Id = 100,
                Name = "Chal1",
                State = "visible",
                Value = 100
            });
            ctx.Challenges.Add(new Challenge
            {
                Id = 101,
                Name = "Chal2",
                State = "visible",
                Value = 200
            });
            ctx.Challenges.Add(new Challenge
            {
                Id = 102,
                Name = "HiddenChal",
                State = "hidden",
                Value = 999
            });

            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx, options);

            // Act: gọi GetTeamScore cho user1
            var result = await svc.GetTeamScore(user1.Id);

            // Assert
            Assert.NotNull(result);
            var dto = result!;

            // Team name
            Assert.Equal("TeamA", dto.Name);

            // Chỉ có 1 team trong hệ thống, score = 0 -> đứng hạng 1
            Assert.Equal(1, dto.Place);

            // Members gồm đủ 2 người
            Assert.Equal(2, dto.Members.Count);
            Assert.Contains(dto.Members, m => m.Name == "Alice" && m.Email == "alice@example.com");
            Assert.Contains(dto.Members, m => m.Name == "Bob" && m.Email == "bob@example.com");

            // Chưa có solves/awards nào -> Score = 0
            Assert.Equal(0, dto.Score);

            // ChallengeTotalScore = 100 + 200 (chỉ visible)
            Assert.Equal(300, dto.ChallengeTotalScore);
        }
    }
}

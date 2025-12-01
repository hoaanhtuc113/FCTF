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
    public class TeamService_GetTeamSolves : TestBase
    {
        private DbContextOptions<AppDbContext> CreateOptions()
        {
            return new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
        }

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

        [Fact]
        public async Task GetTeamSolves_Returns_Empty_When_User_Has_No_Team()
        {
            var options = CreateOptions();
            using var ctx = new AppDbContext(options);

            ctx.Users.Add(new User
            {
                Id = 1,
                Name = "UserNoTeam",
                TeamId = null
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx, options);

            var result = await svc.GetTeamSolves(1);

            Assert.NotNull(result);
            Assert.Empty(result);
        }

        [Fact]
        public async Task GetTeamSolves_Returns_Solves_For_User_Team()
        {
            var options = CreateOptions();
            using var ctx = new AppDbContext(options);

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
                TeamId = team.Id
            };
            var user2 = new User
            {
                Id = 2,
                Name = "Bob",
                TeamId = team.Id
            };
            ctx.Users.AddRange(user1, user2);

            var chal1 = new Challenge
            {
                Id = 100,
                Name = "Chal1",
                Category = "pwn",
                State = "visible",
                Value = 100
            };
            var chal2 = new Challenge
            {
                Id = 101,
                Name = "Chal2",
                Category = "web",
                State = "visible",
                Value = 200
            };
            ctx.Challenges.AddRange(chal1, chal2);

            var sub1 = new Submission
            {
                Id = 1000,
                Date = new DateTime(2025, 1, 1, 10, 0, 0),
                Type = "correct"
            };
            var sub2 = new Submission
            {
                Id = 1001,
                Date = new DateTime(2025, 1, 1, 11, 0, 0),
                Type = "correct"
            };
            ctx.Submissions.AddRange(sub1, sub2);

            var solve1 = new Solf
            {
                Id = 1000,
                ChallengeId = chal1.Id,
                UserId = user1.Id,
                IdNavigation = sub1,
                Challenge = chal1,
                User = user1
            };
            var solve2 = new Solf
            {
                Id = 1001,
                ChallengeId = chal2.Id,
                UserId = user2.Id,
                IdNavigation = sub2,
                Challenge = chal2,
                User = user2
            };
            ctx.Solves.AddRange(solve1, solve2);

            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx, options);

            var result = await svc.GetTeamSolves(user1.Id);

            Assert.NotNull(result);
            Assert.Equal(2, result.Count);

            // Đã order theo Date giảm dần → solve2 trước
            var first = result[0];
            var second = result[1];

            Assert.Equal(chal2.Id, first.ChallengeId);
            Assert.NotNull(first.Challenge);
            Assert.Equal("Chal2", first.Challenge!.Name);
            Assert.Equal("web", first.Challenge.Category);
            Assert.Equal(200, first.Challenge.Value);
            Assert.NotNull(first.User);
            Assert.Equal("Bob", first.User!.Name);
            Assert.NotNull(first.Team);
            Assert.Equal("TeamA", first.Team!.Name);
            Assert.Equal(sub2.Date, first.Date);
            Assert.Equal(sub2.Type, first.Type);

            Assert.Equal(chal1.Id, second.ChallengeId);
            Assert.NotNull(second.Challenge);
            Assert.Equal("Chal1", second.Challenge!.Name);
            Assert.Equal("pwn", second.Challenge.Category);
            Assert.Equal(100, second.Challenge.Value);
            Assert.NotNull(second.User);
            Assert.Equal("Alice", second.User!.Name);
            Assert.NotNull(second.Team);
            Assert.Equal("TeamA", second.Team!.Name);
            Assert.Equal(sub1.Date, second.Date);
            Assert.Equal(sub1.Type, second.Type);
        }
    }
}


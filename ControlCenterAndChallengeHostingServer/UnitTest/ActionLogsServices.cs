using System;
using System.Linq;
using System.Threading.Tasks;
using ContestantBE.Services;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.ActionLogs;
using ResourceShared.Models;
using Xunit;

namespace UnitTest
{
    public class ActionLogsServices : TestBase
    {
        private ContestantBE.Services.ActionLogsServices CreateService(AppDbContext ctx)
            => new ContestantBE.Services.ActionLogsServices(ctx);

        [Fact]
        public async Task SaveActionLogs_WithExistingChallengeAndUser_MapsCategoryAndUserName()
        {
            using var ctx = CreateContext(nameof(SaveActionLogs_WithExistingChallengeAndUser_MapsCategoryAndUserName));

            var user = new User { Id = 1, Name = "Alice" };
            var challenge = new Challenge
            {
                Id = 10,
                Name = "Web 1",
                Category = "web"
            };
            ctx.Users.Add(user);
            ctx.Challenges.Add(challenge);
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);
            var req = new ActionLogsReq
            {
                ActionType = 1,
                ActionDetail = "View challenge",
                ChallengeId = 10
            };

            var before = DateTime.UtcNow;
            var dto = await svc.SaveActionLogs(req, userId: 1);
            var after = DateTime.UtcNow;

            Assert.Equal(1, dto.UserId);
            Assert.Equal("Alice", dto.UserName);
            Assert.Equal(1, dto.ActionType);
            Assert.Equal("View challenge", dto.ActionDetail);
            Assert.Equal("web", dto.TopicName);
            Assert.True(dto.ActionDate >= before && dto.ActionDate <= after);

            var logInDb = await ctx.ActionLogs.SingleAsync();
            Assert.Equal(1, logInDb.UserId);
            Assert.Equal(1, logInDb.ActionType);
            Assert.Equal("View challenge", logInDb.ActionDetail);
            Assert.Equal("web", logInDb.TopicName);
        }

        [Fact]
        public async Task SaveActionLogs_NoChallenge_SetsTopicNameNullString()
        {
            using var ctx = CreateContext(nameof(SaveActionLogs_NoChallenge_SetsTopicNameNullString));

            var user = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(user);
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);
            var req = new ActionLogsReq
            {
                ActionType = 2,
                ActionDetail = "Submit flag",
                ChallengeId = 999
            };

            var dto = await svc.SaveActionLogs(req, userId: 1);

            Assert.Equal("Null", dto.TopicName);

            var log = await ctx.ActionLogs.SingleAsync();
            Assert.Equal("Null", log.TopicName);
        }

        [Fact]
        public async Task SaveActionLogs_NoUserInDb_ReturnsEmptyUserName()
        {
            using var ctx = CreateContext(nameof(SaveActionLogs_NoUserInDb_ReturnsEmptyUserName));

            var challenge = new Challenge
            {
                Id = 10,
                Name = "Pwn 1",
                Category = "pwn"
            };
            ctx.Challenges.Add(challenge);
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);
            var req = new ActionLogsReq
            {
                ActionType = 3,
                ActionDetail = "Start challenge",
                ChallengeId = 10
            };

            var dto = await svc.SaveActionLogs(req, userId: 123);

            Assert.Equal(123, dto.UserId);
            Assert.Equal("", dto.UserName);
            Assert.Equal("pwn", dto.TopicName);

            var log = await ctx.ActionLogs.SingleAsync();
            Assert.Equal(123, log.UserId);
        }
    }

    public class ActionLogsServices_GetActionLogs_Tests : TestBase
    {
        private ContestantBE.Services.ActionLogsServices CreateService(AppDbContext ctx)
            => new ContestantBE.Services.ActionLogsServices(ctx);

        [Fact]
        public async Task GetActionLogs_Returns_All_Ordered_Desc_With_UserName()
        {
            using var ctx = CreateContext(nameof(GetActionLogs_Returns_All_Ordered_Desc_With_UserName));

            var u1 = new User { Id = 1, Name = "Alice" };
            var u2 = new User { Id = 2, Name = "Bob" };
            ctx.Users.AddRange(u1, u2);

            ctx.ActionLogs.AddRange(
                new ActionLog
                {
                    ActionId = 1,
                    UserId = 1,
                    ActionType = 1,
                    ActionDetail = "A1",
                    TopicName = "web",
                    ActionDate = new DateTime(2025, 1, 2, 12, 0, 0)
                },
                new ActionLog
                {
                    ActionId = 2,
                    UserId = 2,
                    ActionType = 2,
                    ActionDetail = "A2",
                    TopicName = "pwn",
                    ActionDate = new DateTime(2025, 1, 3, 12, 0, 0)
                },
                new ActionLog
                {
                    ActionId = 3,
                    UserId = null,
                    ActionType = 3,
                    ActionDetail = "A3",
                    TopicName = "misc",
                    ActionDate = new DateTime(2025, 1, 1, 12, 0, 0)
                }
            );
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);
            var result = await svc.GetActionLogs();

            Assert.Equal(3, result.Count);
            Assert.Equal(2, result[0].ActionId);
            Assert.Equal(1, result[1].ActionId);
            Assert.Equal(3, result[2].ActionId);

            var log2 = result[0];
            Assert.Equal("Bob", log2.UserName);
            var log1 = result[1];
            Assert.Equal("Alice", log1.UserName);
            var log3 = result[2];
            Assert.Equal("", log3.UserName);
        }

        [Fact]
        public async Task GetActionLogs_Returns_Empty_When_No_Data()
        {
            using var ctx = CreateContext(nameof(GetActionLogs_Returns_Empty_When_No_Data));

            var svc = CreateService(ctx);
            var result = await svc.GetActionLogs();

            Assert.NotNull(result);
            Assert.Empty(result);
        }
    }

    public class ActionLogsServices_GetActionLogsTeam_Tests : TestBase
    {
        private ContestantBE.Services.ActionLogsServices CreateService(AppDbContext ctx)
            => new ContestantBE.Services.ActionLogsServices(ctx);

        [Fact]
        public async Task GetActionLogsTeam_Returns_Only_Logs_Of_Team()
        {
            using var ctx = CreateContext(nameof(GetActionLogsTeam_Returns_Only_Logs_Of_Team));

            var team1 = new Team { Id = 1, Name = "TeamA" };
            var team2 = new Team { Id = 2, Name = "TeamB" };

            var u1 = new User { Id = 1, Name = "Alice", TeamId = 1 };
            var u2 = new User { Id = 2, Name = "Bob", TeamId = 1 };
            var u3 = new User { Id = 3, Name = "Charlie", TeamId = 2 };
            var u4 = new User { Id = 4, Name = "NoTeam", TeamId = null };

            ctx.Teams.AddRange(team1, team2);
            ctx.Users.AddRange(u1, u2, u3, u4);

            ctx.ActionLogs.AddRange(
                new ActionLog
                {
                    ActionId = 1,
                    UserId = 1,
                    ActionType = 1,
                    ActionDetail = "A1",
                    TopicName = "web",
                    ActionDate = new DateTime(2025, 1, 2, 10, 0, 0)
                },
                new ActionLog
                {
                    ActionId = 2,
                    UserId = 2,
                    ActionType = 2,
                    ActionDetail = "A2",
                    TopicName = "pwn",
                    ActionDate = new DateTime(2025, 1, 3, 10, 0, 0)
                },
                new ActionLog
                {
                    ActionId = 3,
                    UserId = 3,
                    ActionType = 3,
                    ActionDetail = "A3",
                    TopicName = "misc",
                    ActionDate = new DateTime(2025, 1, 4, 10, 0, 0)
                },
                new ActionLog
                {
                    ActionId = 4,
                    UserId = 4,
                    ActionType = 4,
                    ActionDetail = "A4",
                    TopicName = "other",
                    ActionDate = new DateTime(2025, 1, 5, 10, 0, 0)
                }
            );
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);
            var result = await svc.GetActionLogsTeam(teamId: 1);

            Assert.Equal(2, result.Count);
            Assert.All(result, r => Assert.True(r.UserId == 1 || r.UserId == 2));
            Assert.Equal(2, result[0].ActionId);
            Assert.Equal(1, result[1].ActionId);
            Assert.Equal("Bob", result[0].UserName);
            Assert.Equal("Alice", result[1].UserName);
        }

        [Fact]
        public async Task GetActionLogsTeam_Returns_Empty_When_No_User_In_Team()
        {
            using var ctx = CreateContext(nameof(GetActionLogsTeam_Returns_Empty_When_No_User_In_Team));

            var team = new Team { Id = 10, Name = "TeamX" };
            var user = new User { Id = 1, Name = "Alice", TeamId = 1 };
            ctx.Teams.Add(team);
            ctx.Users.Add(user);

            ctx.ActionLogs.Add(new ActionLog
            {
                ActionId = 1,
                UserId = 1,
                ActionType = 1,
                ActionDetail = "A1",
                TopicName = "web",
                ActionDate = DateTime.UtcNow
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);
            var result = await svc.GetActionLogsTeam(teamId: 10);

            Assert.NotNull(result);
            Assert.Empty(result);
        }
    }
}

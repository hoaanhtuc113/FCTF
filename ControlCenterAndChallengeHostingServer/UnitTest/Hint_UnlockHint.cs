using System;
using System.Linq;
using System.Threading.Tasks;
using ContestantBE.Services;
using ResourceShared.DTOs.Hint;
using ResourceShared.Models;
using ResourceShared.Utils;
using Xunit;
using Moq;

namespace UnitTest
{
    public class Hint_UnlockHint : TestBase
    {
        // Helper tạo service với Score và TeamsMode mong muốn
        private HintService CreateService(AppDbContext ctx, int teamScore, bool teamMode)
        {
            var scoreHelperMock = new Mock<ScoreHelper>();
            scoreHelperMock
                .Setup(s => s.GetTeamScore(It.IsAny<Team>(), true))
                .ReturnsAsync(teamScore);

            var configHelperMock = new Mock<ConfigHelper>();
            configHelperMock
                .Setup(c => c.IsTeamsMode())
                .Returns(teamMode);

            return new HintService(ctx, scoreHelperMock.Object, configHelperMock.Object);
        }

        private (Team team, User user) AddUserWithTeam(AppDbContext ctx, int id = 1)
        {
            var team = new Team { Id = id, Name = $"Team {id}" };
            var user = new User { Id = id, Name = $"user{id}", TeamId = team.Id, Team = team };
            ctx.Teams.Add(team);
            ctx.Users.Add(user);
            return (team, user);
        }

        private Hint AddHint(
            AppDbContext ctx,
            int id,
            int? cost,
            string? requirements,
            string? content = "hint")
        {
            var hint = new Hint
            {
                Id = id,
                Type = "standard",
                ChallengeId = 10,
                Content = content,
                Cost = cost,
                Requirements = requirements,
                Challenge = new Challenge
                {
                    Id = 10,
                    Name = "Test challenge"
                }
            };
            ctx.Hints.Add(hint);
            return hint;
        }

        private UnlockRequestDto Req(int target, string type = "hints")
            => new UnlockRequestDto
            {
                Target = target,
                Type = type
            };

        // 1️⃣ UHINT_001 - Hint target không tồn tại -> trả về null
        [Fact]
        public async Task UHINT_001_TargetHintNotFound_ReturnsNull()
        {
            using var ctx = CreateContext(nameof(UHINT_001_TargetHintNotFound_ReturnsNull));

            var (_, user) = AddUserWithTeam(ctx);
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx, teamScore: 100, teamMode: true);

            var req = Req(target: 999);

            var res = await service.UnlockHint(req, user.Id);

            Assert.Null(res);
            Assert.Empty(ctx.Unlocks);
            Assert.Empty(ctx.Awards);
        }

        // 2️⃣ UHINT_002 - Chưa unlock đủ prerequisites -> throw InvalidOperationException "You must unlock other hints..."
        [Fact]
        public async Task UHINT_002_PrerequisitesNotUnlocked_ThrowsInvalidOperation()
        {
            using var ctx = CreateContext(nameof(UHINT_002_PrerequisitesNotUnlocked_ThrowsInvalidOperation));

            var (team, user) = AddUserWithTeam(ctx);

            // Hint prerequisite (Id=1) có cost > 0, user chưa unlock
            var prereq = AddHint(ctx, id: 1, cost: 20, requirements: null, content: "Prereq");
            // Target hint yêu cầu phải có hint 1
            var target = AddHint(
                ctx,
                id: 2,
                cost: 20,
                requirements: "{\"prerequisites\":[1]}",
                content: "Target");

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx, teamScore: 100, teamMode: true);
            var req = Req(target.Id);

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => service.UnlockHint(req, user.Id));

            Assert.Equal("You must unlock other hints before accessing this hint", ex.Message);
            Assert.Empty(ctx.Unlocks);
            Assert.Empty(ctx.Awards);
        }

        // 3️⃣ UHINT_003 - Điểm không đủ -> throw "Not enough points to unlock this hint"
        [Fact]
        public async Task UHINT_003_NotEnoughPoints_ThrowsInvalidOperation()
        {
            using var ctx = CreateContext(nameof(UHINT_003_NotEnoughPoints_ThrowsInvalidOperation));

            var (team, user) = AddUserWithTeam(ctx);

            // Không có prerequisites để không dính case khác
            var target = AddHint(
                ctx,
                id: 1,
                cost: 100,
                requirements: null,
                content: "Expensive hint");

            await ctx.SaveChangesAsync();

            // teamScore < cost
            var service = CreateService(ctx, teamScore: 50, teamMode: true);

            var req = Req(target.Id);

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => service.UnlockHint(req, user.Id));

            Assert.Equal("Not enough points to unlock this hint", ex.Message);
            Assert.Empty(ctx.Unlocks);
            Assert.Empty(ctx.Awards);
        }

        // 4️⃣ UHINT_004 - Team mode: đã có Unlock cho cùng Team + Target + Type -> throw "Already unlocked"
        [Fact]
        public async Task UHINT_004_TeamMode_AlreadyUnlocked_ThrowsInvalidOperation()
        {
            using var ctx = CreateContext(nameof(UHINT_004_TeamMode_AlreadyUnlocked_ThrowsInvalidOperation));

            var (team, user) = AddUserWithTeam(ctx);
            var target = AddHint(ctx, id: 1, cost: 10, requirements: null, content: "hint");

            // Có sẵn unlock theo Team
            ctx.Unlocks.Add(new Unlock
            {
                Target = target.Id,
                Type = "hints",
                TeamId = team.Id,
                UserId = null,
                Date = DateTime.UtcNow
            });

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx, teamScore: 100, teamMode: true);
            var req = Req(target.Id);

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => service.UnlockHint(req, user.Id));

            Assert.Equal("Already unlocked", ex.Message);
            // Không thêm unlock/award mới
            Assert.Equal(1, ctx.Unlocks.Count());
            Assert.Empty(ctx.Awards);
        }

        // 5️⃣ UHINT_005 - User mode: đã có Unlock cho cùng User + Target + Type -> throw "Already unlocked"
        [Fact]
        public async Task UHINT_005_UserMode_AlreadyUnlocked_ThrowsInvalidOperation()
        {
            using var ctx = CreateContext(nameof(UHINT_005_UserMode_AlreadyUnlocked_ThrowsInvalidOperation));

            var (team, user) = AddUserWithTeam(ctx);
            var target = AddHint(ctx, id: 1, cost: 10, requirements: null, content: "hint");

            ctx.Unlocks.Add(new Unlock
            {
                Target = target.Id,
                Type = "hints",
                TeamId = team.Id,
                UserId = user.Id,
                Date = DateTime.UtcNow
            });

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx, teamScore: 100, teamMode: false);
            var req = Req(target.Id);

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => service.UnlockHint(req, user.Id));

            Assert.Equal("Already unlocked", ex.Message);
            Assert.Equal(1, ctx.Unlocks.Count());
            Assert.Empty(ctx.Awards);
        }

        // 6️⃣ UHINT_006 - Prereq đã thỏa + đủ điểm + Team mode: unlock thành công, tạo Unlock & Award đúng
        [Fact]
        public async Task UHINT_006_TeamMode_Success_CreatesUnlockAndAward()
        {
            using var ctx = CreateContext(nameof(UHINT_006_TeamMode_Success_CreatesUnlockAndAward));

            var (team, user) = AddUserWithTeam(ctx);

            // Hint prerequisite (Id=1), user đã unlock
            var prereq = AddHint(ctx, id: 1, cost: 10, requirements: null, content: "Prereq");

            ctx.Unlocks.Add(new Unlock
            {
                Target = prereq.Id,
                Type = "hints",
                TeamId = team.Id,
                UserId = user.Id,
                Date = DateTime.UtcNow.AddMinutes(-5)
            });

            // Target yêu cầu prereq 1
            var target = AddHint(
                ctx,
                id: 2,
                cost: 20,
                requirements: "{\"prerequisites\":[1]}",
                content: "Target");

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx, teamScore: 100, teamMode: true);
            var req = Req(target.Id);

            var res = await service.UnlockHint(req, user.Id);

            Assert.NotNull(res);
            Assert.True(res!.Id > 0);
            Assert.Equal("hints", res.Type);
            Assert.Equal(target.Id, res.Target);
            Assert.Equal(team.Id, res.TeamId);
            Assert.Equal(user.Id, res.UserId);
            Assert.NotNull(res.Date);

            // DB
            var dbUnlock = ctx.Unlocks.Single(u => u.Id == res.Id);
            Assert.Equal(target.Id, dbUnlock.Target);
            Assert.Equal(team.Id, dbUnlock.TeamId);
            Assert.Equal(user.Id, dbUnlock.UserId);

            var award = ctx.Awards.Single();
            Assert.Equal(user.Id, award.UserId);
            Assert.Equal(team.Id, award.TeamId);
            Assert.Equal("Hint " + target.ChallengeId, award.Name);
            Assert.Equal("Hint for " + target.Challenge!.Name, award.Description);
            Assert.Equal(-target.Cost.GetValueOrDefault(), award.Value);
            Assert.Equal("hint", award.Category);
        }

        // 7️⃣ UHINT_007 - User mode: không có prereq, đủ điểm -> unlock thành công theo UserId
        [Fact]
        public async Task UHINT_007_UserMode_Success_CreatesUnlockWithUserCheck()
        {
            using var ctx = CreateContext(nameof(UHINT_007_UserMode_Success_CreatesUnlockWithUserCheck));

            var (team, user) = AddUserWithTeam(ctx);

            var target = AddHint(
                ctx,
                id: 1,
                cost: 15,
                requirements: null,
                content: "simple hint");

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx, teamScore: 100, teamMode: false);
            var req = Req(target.Id);

            var res = await service.UnlockHint(req, user.Id);

            Assert.NotNull(res);
            Assert.Equal(user.Id, res!.UserId);
            Assert.Equal(team.Id, res.TeamId);

            var dbUnlock = ctx.Unlocks.Single(u => u.Id == res.Id);
            Assert.Equal(user.Id, dbUnlock.UserId);
            Assert.Equal(team.Id, dbUnlock.TeamId);
        }
    }
}

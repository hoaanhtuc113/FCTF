using System;
using System.Threading.Tasks;
using ContestantBE.Services;
using ResourceShared.Models;
using Xunit;

namespace UnitTest
{
    public class Hint_GetHintById : TestBase
    {
        // Helper tạo service
        private HintService CreateService(AppDbContext ctx)
            => new HintService(ctx, scoreHelper: null!, configHelper: null!);

        // Helper tạo team + user
        private (Team team, User user) AddUserWithTeam(AppDbContext ctx, int id = 1)
        {
            var team = new Team { Id = id, Name = $"Team {id}" };
            var user = new User { Id = id, Name = $"user{id}", TeamId = team.Id, Team = team };
            ctx.Teams.Add(team);
            ctx.Users.Add(user);
            return (team, user);
        }

        // Helper tạo hint
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
                Requirements = requirements
            };
            ctx.Hints.Add(hint);
            return hint;
        }

        // 1️⃣ hint == null -> return null
        [Fact]
        public async Task HINT_001_HintNotFound_ReturnsNull()
        {
            using var ctx = CreateContext(nameof(HINT_001_HintNotFound_ReturnsNull));
            var service = CreateService(ctx);

            var res = await service.GetHintById(id: 999, userId: 1, preview: false);

            Assert.Null(res);
        }

        // 2️⃣ user == null + Cost != null + prerequisites.Count > 0 -> early return locked summary
        [Fact]
        public async Task HINT_002_UserNull_WithCostAndPrereq_ReturnsLockedSummary()
        {
            using var ctx = CreateContext(nameof(HINT_002_UserNull_WithCostAndPrereq_ReturnsLockedSummary));
            AddHint(ctx,
                id: 1,
                cost: 50,
                requirements: "{\"prerequisites\":[2,3]}",
                content: "Secret hint");
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.GetHintById(1, userId: null, preview: false);

            Assert.NotNull(res);
            Assert.Equal(1, res!.Id);
            Assert.Equal(10, res.ChallengeId);
            Assert.Equal(50, res.Cost);
            Assert.Equal("locked", res.View);
            Assert.Null(res.Content);
            Assert.Null(res.Html);
            // early return không set Requirements => null là đúng với code
            Assert.Null(res.Requirements);
        }

        // 3️⃣ user == null + Cost = 0 + không prerequisites -> không vào early return, free hint → unlocked
        [Fact]
        public async Task HINT_003_UserNull_FreeHint_NoPrereq_Unlocked()
        {
            using var ctx = CreateContext(nameof(HINT_003_UserNull_FreeHint_NoPrereq_Unlocked));
            AddHint(ctx,
                id: 1,
                cost: 0,
                requirements: null,
                content: "Free hint");
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.GetHintById(1, userId: null, preview: false);

            Assert.NotNull(res);
            Assert.Equal("unlocked", res!.View);
            Assert.Equal("Free hint", res.Content);
            Assert.Equal("<p>Free hint</p>\n", res.Html);
            Assert.Null(res.Requirements);
        }

        // 4️⃣ user == null + Cost = null + có prerequisites -> vẫn không vào early return, free → unlocked
        [Fact]
        public async Task HINT_004_UserNull_NoCost_WithPrereq_Unlocked()
        {
            using var ctx = CreateContext(nameof(HINT_004_UserNull_NoCost_WithPrereq_Unlocked));
            AddHint(ctx,
                id: 1,
                cost: null,
                requirements: "{\"prerequisites\":[1,2]}",
                content: "Free with prereq");
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.GetHintById(1, userId: null, preview: false);

            Assert.NotNull(res);
            Assert.Equal("unlocked", res!.View);
            Assert.Equal("Free with prereq", res.Content);
            Assert.Equal("<p>Free with prereq</p>\n", res.Html);
            Assert.Equal("{\"prerequisites\":[1,2]}", res.Requirements);
        }

        // 5️⃣ user != null + free hint (Cost = 0) + có content -> unlocked + html
        [Fact]
        public async Task HINT_005_UserExists_FreeHint_WithContent_Unlocked()
        {
            using var ctx = CreateContext(nameof(HINT_005_UserExists_FreeHint_WithContent_Unlocked));
            var (_, user) = AddUserWithTeam(ctx);
            AddHint(ctx,
                id: 1,
                cost: 0,
                requirements: null,
                content: "Free hint");
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.GetHintById(1, user.Id, preview: false);

            Assert.NotNull(res);
            Assert.Equal("unlocked", res!.View);
            Assert.Equal("Free hint", res.Content);
            Assert.Equal("<p>Free hint</p>\n", res.Html);
        }

        // 6️⃣ user != null + free hint nhưng Content = null -> unlocked nhưng không html
        [Fact]
        public async Task HINT_006_UserExists_FreeHint_NoContent_UnlockedNoHtml()
        {
            using var ctx = CreateContext(nameof(HINT_006_UserExists_FreeHint_NoContent_UnlockedNoHtml));
            var (_, user) = AddUserWithTeam(ctx);
            AddHint(ctx,
                id: 1,
                cost: 0,
                requirements: null,
                content: null);
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.GetHintById(1, user.Id, preview: false);

            Assert.NotNull(res);
            Assert.Equal("unlocked", res!.View);
            Assert.Null(res.Content);
            Assert.Null(res.Html);
        }

        // 7️⃣ user != null + Cost > 0 + chưa unlock -> view = locked, không content/html
        [Fact]
        public async Task HINT_007_UserExists_PaidHint_NotUnlocked_Locked()
        {
            using var ctx = CreateContext(nameof(HINT_007_UserExists_PaidHint_NotUnlocked_Locked));
            var (_, user) = AddUserWithTeam(ctx);
            AddHint(ctx,
                id: 1,
                cost: 30,
                requirements: null,
                content: "Paid hint");
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.GetHintById(1, user.Id, preview: false);

            Assert.NotNull(res);
            Assert.Equal("locked", res!.View);
            Assert.Null(res.Content);
            Assert.Null(res.Html);
        }

        // 8️⃣ user != null + Cost > 0 + Unlock đúng user/target -> unlocked + html
        [Fact]
        public async Task HINT_008_UserExists_PaidHint_AlreadyUnlocked_Unlocked()
        {
            using var ctx = CreateContext(nameof(HINT_008_UserExists_PaidHint_AlreadyUnlocked_Unlocked));
            var (team, user) = AddUserWithTeam(ctx);
            var hint = AddHint(ctx,
                id: 1,
                cost: 30,
                requirements: null,
                content: "Paid content");

            ctx.Unlocks.Add(new Unlock
            {
                Target = hint.Id,
                Type = "hints",
                UserId = user.Id,
                TeamId = team.Id,
                Date = DateTime.UtcNow
            });

            await ctx.SaveChangesAsync();
            var service = CreateService(ctx);

            var res = await service.GetHintById(1, user.Id, preview: false);

            Assert.NotNull(res);
            Assert.Equal("unlocked", res!.View);
            Assert.Equal("Paid content", res.Content);
            Assert.Equal("<p>Paid content</p>\n", res.Html);
        }

        // 9️⃣ Requirements malformed JSON -> GetPrerequisites catch lỗi, treated như không có prereq
        // Dùng free hint để confirm: không crash, vẫn unlocked
        [Fact]
        public async Task HINT_009_MalformedRequirements_FreeHint_StillUnlocked()
        {
            using var ctx = CreateContext(nameof(HINT_009_MalformedRequirements_FreeHint_StillUnlocked));
            var (_, user) = AddUserWithTeam(ctx);
            AddHint(ctx,
                id: 1,
                cost: 0,
                requirements: "not json",
                content: "Free");
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var res = await service.GetHintById(1, user.Id, preview: false);

            Assert.NotNull(res);
            Assert.Equal("unlocked", res!.View);
            Assert.Equal("Free", res.Content);
            Assert.Equal("<p>Free</p>\n", res.Html);
        }
    }
}

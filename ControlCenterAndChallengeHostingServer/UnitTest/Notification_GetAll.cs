using System;
using System.Linq;
using System.Threading.Tasks;
using ContestantBE.Services;
using ResourceShared.Models;
using Xunit;

namespace UnitTest
{
    public class Notification_GetAll : TestBase
    {
        private NotificationServices CreateService(AppDbContext ctx)
            => new NotificationServices(ctx);

        private (Team team, User user) AddTeamAndUser(AppDbContext ctx, int id = 1)
        {
            var team = new Team { Id = id, Name = $"Team {id}" };
            var user = new User { Id = id, Name = $"user{id}", TeamId = team.Id, Team = team };
            ctx.Teams.Add(team);
            ctx.Users.Add(user);
            return (team, user);
        }

        private Notification AddNotification(
            AppDbContext ctx,
            int id,
            string? title,
            string? content,
            DateTime? date,
            int? userId,
            int? teamId,
            Team? team = null,
            User? user = null)
        {
            var noti = new Notification
            {
                Id = id,
                Title = title,
                Content = content,
                Date = date,
                UserId = userId,
                TeamId = teamId,
                Team = team,
                User = user
            };
            ctx.Notifications.Add(noti);
            return noti;
        }

        /// <summary>
        /// NTF_001 - Không có notification nào -> trả list rỗng
        /// </summary>
        [Fact]
        public async Task NTF_001_NoNotifications_ReturnsEmptyList()
        {
            using var ctx = CreateContext(nameof(NTF_001_NoNotifications_ReturnsEmptyList));
            var service = CreateService(ctx);

            var result = await service.GetAll();

            Assert.NotNull(result);
            Assert.Empty(result);
        }

        /// <summary>
        /// NTF_002 - Một notification đơn, map đúng các field scalar (Id, Title, Content, Date, User_id, Team_id)
        /// </summary>
        [Fact]
        public async Task NTF_002_SingleNotification_MapsScalarFieldsCorrectly()
        {
            using var ctx = CreateContext(nameof(NTF_002_SingleNotification_MapsScalarFieldsCorrectly));

            var date = new DateTime(2025, 11, 29, 10, 0, 0);
            AddNotification(
                ctx,
                id: 1,
                title: "Title 1",
                content: "Content 1",
                date: date,
                userId: 5,
                teamId: 9);
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetAll();

            Assert.Single(result);

            var dto = result[0];
            Assert.Equal(1, dto.Id);
            Assert.Equal("Title 1", dto.Title);
            Assert.Equal("Content 1", dto.Content);
            Assert.Equal(date, dto.Date);
            Assert.Equal(5, dto.User_id);
            Assert.Equal(9, dto.Team_id);
        }

        /// <summary>
        /// NTF_003 - Nhiều notification -> trả đủ số lượng, đúng Id
        /// </summary>
        [Fact]
        public async Task NTF_003_MultipleNotifications_ReturnsAll()
        {
            using var ctx = CreateContext(nameof(NTF_003_MultipleNotifications_ReturnsAll));

            AddNotification(ctx, id: 1, title: "T1", content: "C1", date: null, userId: null, teamId: null);
            AddNotification(ctx, id: 2, title: "T2", content: "C2", date: null, userId: null, teamId: null);
            AddNotification(ctx, id: 3, title: "T3", content: "C3", date: null, userId: null, teamId: null);

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetAll();

            Assert.Equal(3, result.Count);

            var ids = result.Select(n => n.Id).OrderBy(x => x).ToList();
            Assert.Equal(new[] { 1, 2, 3 }, ids);
        }

        /// <summary>
        /// NTF_004 - Map đúng navigation User & Team (User/Team trong DTO chính là User/Team của entity)
        /// </summary>
        [Fact]
        public async Task NTF_004_MapsUserAndTeamNavigationCorrectly()
        {
            using var ctx = CreateContext(nameof(NTF_004_MapsUserAndTeamNavigationCorrectly));

            var (team, user) = AddTeamAndUser(ctx);

            AddNotification(
                ctx,
                id: 1,
                title: "Has nav",
                content: "With user/team",
                date: DateTime.UtcNow,
                userId: user.Id,
                teamId: team.Id,
                team: team,
                user: user);

            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetAll();

            Assert.Single(result);
            var dto = result[0];

            Assert.NotNull(dto.User);
            Assert.NotNull(dto.Team);
            Assert.Equal(user.Id, dto.User!.Id);
            Assert.Equal(team.Id, dto.Team!.Id);
            Assert.Equal(user.Id, dto.User_id);
            Assert.Equal(team.Id, dto.Team_id);
        }

        /// <summary>
        /// NTF_005 - Content null -> html cũng phải null (html = n.Content)
        /// </summary>
        [Fact]
        public async Task NTF_005_ContentNull_HtmlAlsoNull()
        {
            using var ctx = CreateContext(nameof(NTF_005_ContentNull_HtmlAlsoNull));

            AddNotification(
                ctx,
                id: 1,
                title: "No content",
                content: null,
                date: null,
                userId: null,
                teamId: null);
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetAll();

            Assert.Single(result);
            var dto = result[0];

            Assert.Null(dto.Content);
            Assert.Null(dto.html);
        }

        /// <summary>
        /// NTF_006 - html luôn bằng Content khi Content có giá trị
        /// </summary>
        [Fact]
        public async Task NTF_006_HtmlEqualsContent_WhenContentNotNull()
        {
            using var ctx = CreateContext(nameof(NTF_006_HtmlEqualsContent_WhenContentNotNull));

            AddNotification(
                ctx,
                id: 1,
                title: "HTML test",
                content: "Raw content",
                date: null,
                userId: null,
                teamId: null);
            await ctx.SaveChangesAsync();

            var service = CreateService(ctx);

            var result = await service.GetAll();

            Assert.Single(result);
            var dto = result[0];

            Assert.Equal("Raw content", dto.Content);
            Assert.Equal("Raw content", dto.html);
        }
    }
}

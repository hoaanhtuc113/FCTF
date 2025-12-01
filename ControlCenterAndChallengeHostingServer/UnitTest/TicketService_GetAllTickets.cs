using System;
using System.Linq;
using System.Threading.Tasks;
using ContestantBE.Services;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using Xunit;

namespace UnitTest
{
    public class TicketService_GetAllTickets : TestBase
    {
        private TicketService CreateService(AppDbContext ctx)
            => new TicketService(ctx);

        private async Task SeedBasicAsync(AppDbContext ctx)
        {
            var user1 = new User { Id = 1, Name = "Alice", TeamId = 100 };
            var user2 = new User { Id = 2, Name = "Bob", TeamId = null };
            var replier = new User { Id = 3, Name = "Admin", TeamId = null };

            var team = new Team { Id = 100, Name = "TeamA" };

            ctx.Users.AddRange(user1, user2, replier);
            ctx.Teams.Add(team);

            ctx.Tickets.AddRange(
                new Ticket
                {
                    Id = 1,
                    AuthorId = user1.Id,
                    Title = "Server down",
                    Type = "Bug",
                    Description = "Cannot reach server",
                    Status = "open",
                    CreateAt = new DateTime(2025, 1, 3, 12, 0, 0),
                    ReplierId = replier.Id,
                    ReplierMessage = "We are checking"
                },
                new Ticket
                {
                    Id = 2,
                    AuthorId = user1.Id,
                    Title = "Flag issue",
                    Type = "Question",
                    Description = "Flag format?",
                    Status = "closed",
                    CreateAt = new DateTime(2025, 1, 2, 12, 0, 0),
                    ReplierId = replier.Id,
                    ReplierMessage = "Use FCTF{}"
                },
                new Ticket
                {
                    Id = 3,
                    AuthorId = user2.Id,
                    Title = "UI bug",
                    Type = "Bug",
                    Description = "Button not clickable",
                    Status = "open",
                    CreateAt = new DateTime(2025, 1, 1, 12, 0, 0),
                    ReplierId = null,
                    ReplierMessage = null
                }
            );

            await ctx.SaveChangesAsync();
        }

        [Fact]
        public async Task GetAllTickets_NoFilter_Pagination_FirstPage()
        {
            using var ctx = CreateContext(nameof(GetAllTickets_NoFilter_Pagination_FirstPage));
            await SeedBasicAsync(ctx);
            var svc = CreateService(ctx);

            var res = await svc.GetAllTickets(
                userId: null,
                status: null,
                type: null,
                search: null,
                page: 1,
                perPage: 2);

            Assert.Equal(3, res.Total);
            Assert.Equal(2, res.Tickets.Count);

            // Order by CreateAt desc: Id 1 (2025-01-03) then Id 2 (2025-01-02)
            Assert.Equal(1, res.Tickets[0].Id);
            Assert.Equal(2, res.Tickets[1].Id);
        }

        [Fact]
        public async Task GetAllTickets_NoFilter_Pagination_SecondPage()
        {
            using var ctx = CreateContext(nameof(GetAllTickets_NoFilter_Pagination_SecondPage));
            await SeedBasicAsync(ctx);
            var svc = CreateService(ctx);

            var res = await svc.GetAllTickets(
                userId: null,
                status: null,
                type: null,
                search: null,
                page: 2,
                perPage: 2);

            Assert.Equal(3, res.Total);
            Assert.Single(res.Tickets);
            Assert.Equal(3, res.Tickets[0].Id);
        }

        [Fact]
        public async Task GetAllTickets_Filter_By_UserId()
        {
            using var ctx = CreateContext(nameof(GetAllTickets_Filter_By_UserId));
            await SeedBasicAsync(ctx);
            var svc = CreateService(ctx);

            var res = await svc.GetAllTickets(
                userId: 1,
                status: null,
                type: null,
                search: null,
                page: 1,
                perPage: 10);

            Assert.Equal(2, res.Total);
            Assert.Equal(2, res.Tickets.Count);
            Assert.All(res.Tickets, t => Assert.Equal("Alice", t.AuthorName));
            Assert.All(res.Tickets, t => Assert.Equal("TeamA", t.TeamName));
        }

        [Fact]
        public async Task GetAllTickets_Filter_By_Status_Contains()
        {
            using var ctx = CreateContext(nameof(GetAllTickets_Filter_By_Status_Contains));
            await SeedBasicAsync(ctx);
            var svc = CreateService(ctx);

            var res = await svc.GetAllTickets(
                userId: null,
                status: "open",
                type: null,
                search: null,
                page: 1,
                perPage: 10);

            Assert.Equal(2, res.Total);
            Assert.Equal(2, res.Tickets.Count);
            Assert.All(res.Tickets, t => Assert.Contains("open", t.Status, StringComparison.OrdinalIgnoreCase));
        }

        [Fact]
        public async Task GetAllTickets_Filter_By_Type_And_Search()
        {
            using var ctx = CreateContext(nameof(GetAllTickets_Filter_By_Type_And_Search));
            await SeedBasicAsync(ctx);
            var svc = CreateService(ctx);

            var res = await svc.GetAllTickets(
                userId: null,
                status: null,
                type: "Bug",
                search: "UI",
                page: 1,
                perPage: 10);

            Assert.Equal(1, res.Total);
            Assert.Single(res.Tickets);

            var dto = res.Tickets.Single();
            Assert.Equal(3, dto.Id);
            Assert.Equal("UI bug", dto.Title);
            Assert.Equal("Bug", dto.Type);
        }

        [Fact]
        public async Task GetAllTickets_Maps_Replier_And_Team_Correctly()
        {
            using var ctx = CreateContext(nameof(GetAllTickets_Maps_Replier_And_Team_Correctly));
            await SeedBasicAsync(ctx);
            var svc = CreateService(ctx);

            var res = await svc.GetAllTickets(
                userId: null,
                status: null,
                type: null,
                search: null,
                page: 1,
                perPage: 10);

            var ticket1 = res.Tickets.Single(t => t.Id == 1);
            var ticket2 = res.Tickets.Single(t => t.Id == 2);
            var ticket3 = res.Tickets.Single(t => t.Id == 3);

            Assert.Equal("Alice", ticket1.AuthorName);
            Assert.Equal("TeamA", ticket1.TeamName);
            Assert.Equal("Admin", ticket1.ReplierName);
            Assert.Equal("We are checking", ticket1.ReplierMessage);

            Assert.Equal("Alice", ticket2.AuthorName);
            Assert.Equal("TeamA", ticket2.TeamName);
            Assert.Equal("Admin", ticket2.ReplierName);
            Assert.Equal("Use FCTF{}", ticket2.ReplierMessage);

            Assert.Equal("Bob", ticket3.AuthorName);
            Assert.Null(ticket3.TeamName);
            Assert.Null(ticket3.ReplierName);
            Assert.Null(ticket3.ReplierMessage);
        }

        [Fact]
        public async Task GetAllTickets_Returns_Empty_When_No_Match()
        {
            using var ctx = CreateContext(nameof(GetAllTickets_Returns_Empty_When_No_Match));
            await SeedBasicAsync(ctx);
            var svc = CreateService(ctx);

            var res = await svc.GetAllTickets(
                userId: null,
                status: "non-existing",
                type: null,
                search: null,
                page: 1,
                perPage: 10);

            Assert.Equal(0, res.Total);
            Assert.Empty(res.Tickets);
        }
    }
}

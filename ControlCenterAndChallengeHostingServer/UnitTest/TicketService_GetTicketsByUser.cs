using System;
using System.Linq;
using System.Threading.Tasks;
using ContestantBE.Services;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Ticket;
using ResourceShared.Models;
using Xunit;

namespace UnitTest
{
    public class TicketService_GetTicketsByUser : TestBase
    {
        private TicketService CreateService(AppDbContext ctx)
            => new TicketService(ctx);

        [Fact]
        public async Task GetTicketsByUser_Returns_Empty_When_User_Has_No_Tickets()
        {
            using var ctx = CreateContext(nameof(GetTicketsByUser_Returns_Empty_When_User_Has_No_Tickets));

            ctx.Users.Add(new User { Id = 1, Name = "User1" });
            ctx.Users.Add(new User { Id = 2, Name = "User2" });

            ctx.Tickets.Add(new Ticket
            {
                Id = 10,
                AuthorId = 2,
                Title = "Ticket of User2",
                Type = "Question",
                Description = "Desc",
                Status = "open",
                CreateAt = DateTime.UtcNow
            });

            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var result = await svc.GetTicketsByUser(1);

            Assert.NotNull(result);
            Assert.Empty(result);
        }

        [Fact]
        public async Task GetTicketsByUser_Returns_Tickets_Without_Replier()
        {
            using var ctx = CreateContext(nameof(GetTicketsByUser_Returns_Tickets_Without_Replier));

            var user = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(user);

            ctx.Tickets.Add(new Ticket
            {
                Id = 100,
                AuthorId = user.Id,
                Title = "Help me",
                Type = "Question",
                Description = "How to submit flag?",
                Status = "open",
                CreateAt = new DateTime(2025, 1, 1, 10, 0, 0),
                ReplierId = null,
                ReplierMessage = null
            });

            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var result = await svc.GetTicketsByUser(user.Id);

            Assert.Single(result);
            var dto = result.First();

            Assert.Equal(100, dto.Id);
            Assert.Equal("Alice", dto.AuthorName);
            Assert.Equal("open", dto.Status);
            Assert.Equal("Help me", dto.Title);
            Assert.Equal("Question", dto.Type);
            Assert.Equal(new DateTime(2025, 1, 1, 10, 0, 0), dto.Date);
            Assert.Equal("How to submit flag?", dto.Description);
            Assert.Null(dto.ReplierName);
            Assert.Null(dto.ReplierMessage);
        }

        [Fact]
        public async Task GetTicketsByUser_Returns_Tickets_With_Replier()
        {
            using var ctx = CreateContext(nameof(GetTicketsByUser_Returns_Tickets_With_Replier));

            var author = new User { Id = 1, Name = "Alice" };
            var replier = new User { Id = 2, Name = "Admin" };
            ctx.Users.AddRange(author, replier);

            ctx.Tickets.Add(new Ticket
            {
                Id = 200,
                AuthorId = author.Id,
                Title = "Server down",
                Type = "Bug",
                Description = "Cannot reach CTF instance",
                Status = "closed",
                CreateAt = new DateTime(2025, 1, 2, 12, 0, 0),
                ReplierId = replier.Id,
                ReplierMessage = "Issue resolved, please try again"
            });

            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var result = await svc.GetTicketsByUser(author.Id);

            Assert.Single(result);
            var dto = result.First();

            Assert.Equal(200, dto.Id);
            Assert.Equal("Alice", dto.AuthorName);
            Assert.Equal("closed", dto.Status);
            Assert.Equal("Server down", dto.Title);
            Assert.Equal("Bug", dto.Type);
            Assert.Equal(new DateTime(2025, 1, 2, 12, 0, 0), dto.Date);
            Assert.Equal("Cannot reach CTF instance", dto.Description);
            Assert.Equal("Admin", dto.ReplierName);
            Assert.Equal("Issue resolved, please try again", dto.ReplierMessage);
        }
    }
}

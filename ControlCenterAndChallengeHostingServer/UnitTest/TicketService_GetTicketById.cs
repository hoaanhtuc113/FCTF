using System;
using System.Linq;
using System.Threading.Tasks;
using ContestantBE.Services;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using Xunit;

namespace UnitTest
{
    public class TicketService_GetTicketById : TestBase
    {
        private TicketService CreateService(AppDbContext ctx)
            => new TicketService(ctx);

        [Fact]
        public async Task GetTicketById_Fail_When_Ticket_Not_Found()
        {
            using var ctx = CreateContext(nameof(GetTicketById_Fail_When_Ticket_Not_Found));

            ctx.Users.Add(new User { Id = 1, Name = "User1" });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.GetTicketById(ticketId: 999, userId: 1);

            Assert.False(res.Success);
            Assert.Equal("Ticket not found", res.Message);
            Assert.Null(res.Data);
        }

        [Fact]
        public async Task GetTicketById_Fail_When_User_Is_Not_Owner()
        {
            using var ctx = CreateContext(nameof(GetTicketById_Fail_When_User_Is_Not_Owner));

            var author = new User { Id = 1, Name = "Alice" };
            var otherUser = new User { Id = 2, Name = "Bob" };
            ctx.Users.AddRange(author, otherUser);

            ctx.Tickets.Add(new Ticket
            {
                Id = 10,
                AuthorId = author.Id,
                Title = "Secret ticket",
                Type = "Question",
                Description = "Hidden",
                Status = "open",
                CreateAt = DateTime.UtcNow
            });

            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.GetTicketById(ticketId: 10, userId: 2);

            Assert.False(res.Success);
            Assert.Equal("You don't have permission to view this ticket", res.Message);
            Assert.Null(res.Data);
        }

        [Fact]
        public async Task GetTicketById_Success_When_Ticket_Exists_Without_Replier()
        {
            using var ctx = CreateContext(nameof(GetTicketById_Success_When_Ticket_Exists_Without_Replier));

            var author = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(author);

            var createdAt = new DateTime(2025, 1, 1, 10, 0, 0);

            ctx.Tickets.Add(new Ticket
            {
                Id = 20,
                AuthorId = author.Id,
                Title = "Need help",
                Type = "Question",
                Description = "How to deploy challenge?",
                Status = "open",
                CreateAt = createdAt,
                ReplierId = null,
                ReplierMessage = null
            });

            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.GetTicketById(ticketId: 20, userId: author.Id);

            Assert.True(res.Success);
            Assert.NotNull(res.Data);

            var dto = res.Data!;
            Assert.Equal(20, dto.Id);
            Assert.Equal("Alice", dto.AuthorName);
            Assert.Equal("open", dto.Status);
            Assert.Equal("Need help", dto.Title);
            Assert.Equal("Question", dto.Type);
            Assert.Equal(createdAt, dto.Date);
            Assert.Equal("How to deploy challenge?", dto.Description);
            Assert.Null(dto.ReplierName);
            Assert.Null(dto.ReplierMessage);
        }

        [Fact]
        public async Task GetTicketById_Success_When_Ticket_Exists_With_Replier()
        {
            using var ctx = CreateContext(nameof(GetTicketById_Success_When_Ticket_Exists_With_Replier));

            var author = new User { Id = 1, Name = "Alice" };
            var replier = new User { Id = 2, Name = "Admin" };
            ctx.Users.AddRange(author, replier);

            var createdAt = new DateTime(2025, 1, 2, 12, 0, 0);

            ctx.Tickets.Add(new Ticket
            {
                Id = 30,
                AuthorId = author.Id,
                Title = "Server issue",
                Type = "Bug",
                Description = "Cannot connect to CTFd",
                Status = "closed",
                CreateAt = createdAt,
                ReplierId = replier.Id,
                ReplierMessage = "We restarted the server, try again"
            });

            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.GetTicketById(ticketId: 30, userId: author.Id);

            Assert.True(res.Success);
            Assert.NotNull(res.Data);

            var dto = res.Data!;
            Assert.Equal(30, dto.Id);
            Assert.Equal("Alice", dto.AuthorName);
            Assert.Equal("closed", dto.Status);
            Assert.Equal("Server issue", dto.Title);
            Assert.Equal("Bug", dto.Type);
            Assert.Equal(createdAt, dto.Date);
            Assert.Equal("Cannot connect to CTFd", dto.Description);
            Assert.Equal("Admin", dto.ReplierName);
            Assert.Equal("We restarted the server, try again", dto.ReplierMessage);
        }
    }
}

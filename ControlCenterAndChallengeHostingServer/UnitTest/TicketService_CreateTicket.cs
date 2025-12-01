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
    public class TicketService_CreateTicket : TestBase
    {
        private TicketService CreateService(AppDbContext ctx)
            => new TicketService(ctx);

        [Fact]
        public async Task CreateTicket_Fail_When_Token_Missing()
        {
            using var ctx = CreateContext(nameof(CreateTicket_Fail_When_Token_Missing));
            var svc = CreateService(ctx);

            var req = new CreateTicketRequestDTO
            {
                title = "Title",
                type = "Question",
                description = "Desc"
            };

            var res = await svc.CreateTicket(req, null);

            Assert.False(res.Success);
            Assert.Equal("generatedToken is required", res.Message);
        }

        [Fact]
        public async Task CreateTicket_Fail_When_Token_Not_Found()
        {
            using var ctx = CreateContext(nameof(CreateTicket_Fail_When_Token_Not_Found));
            var svc = CreateService(ctx);

            var req = new CreateTicketRequestDTO
            {
                title = "Title",
                type = "Question",
                description = "Desc"
            };

            var res = await svc.CreateTicket(req, "invalid-token");

            Assert.False(res.Success);
            Assert.Equal("Token not found", res.Message);
        }

        [Fact]
        public async Task CreateTicket_Fail_When_User_Not_Found()
        {
            using var ctx = CreateContext(nameof(CreateTicket_Fail_When_User_Not_Found));

            ctx.Tokens.Add(new Token
            {
                Id = 1,
                UserId = 999,
                Value = "token-1"
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var req = new CreateTicketRequestDTO
            {
                title = "Title",
                type = "Question",
                description = "Desc"
            };

            var res = await svc.CreateTicket(req, "token-1");

            Assert.False(res.Success);
            Assert.Equal("User not found", res.Message);
        }

        [Fact]
        public async Task CreateTicket_Fail_When_Missing_Information()
        {
            using var ctx = CreateContext(nameof(CreateTicket_Fail_When_Missing_Information));

            var user = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(user);
            ctx.Tokens.Add(new Token
            {
                Id = 1,
                UserId = user.Id,
                Value = "token-1"
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var req = new CreateTicketRequestDTO
            {
                title = "   ",
                type = "Question",
                description = "Desc"
            };

            var res = await svc.CreateTicket(req, "token-1");

            Assert.False(res.Success);
            Assert.Equal("Missing information", res.Message);
        }

        [Fact]
        public async Task CreateTicket_Fail_When_Similar_Ticket_Exists()
        {
            using var ctx = CreateContext(nameof(CreateTicket_Fail_When_Similar_Ticket_Exists));

            var user = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(user);
            ctx.Tokens.Add(new Token
            {
                Id = 1,
                UserId = user.Id,
                Value = "token-1"
            });

            var existingTicket = new Ticket
            {
                Id = 10,
                AuthorId = user.Id,
                Title = "Old issue",
                Type = "Question",
                Description = "My CTF environment not working",
                Status = "open",
                CreateAt = DateTime.UtcNow.AddMinutes(-10)
            };
            ctx.Tickets.Add(existingTicket);

            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var req = new CreateTicketRequestDTO
            {
                title = "New issue",
                type = "Question",
                description = "My CTF environment not working"
            };

            var res = await svc.CreateTicket(req, "token-1");

            Assert.False(res.Success);
            Assert.Equal("You have already sent a similar ticket", res.Message);
        }

        [Fact]
        public async Task CreateTicket_Success_When_Valid_And_Not_Similar()
        {
            using var ctx = CreateContext(nameof(CreateTicket_Success_When_Valid_And_Not_Similar));

            var user = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(user);
            ctx.Tokens.Add(new Token
            {
                Id = 1,
                UserId = user.Id,
                Value = "token-1"
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var req = new CreateTicketRequestDTO
            {
                title = "Server down",
                type = "Bug",
                description = "The CTF server is not reachable from my machine"
            };

            var res = await svc.CreateTicket(req, "token-1");

            Assert.True(res.Success);
            Assert.Equal("Send ticket successfully", res.Message);
            Assert.NotNull(res.Data);
            Assert.Equal("Server down", res.Data!.Title);
            Assert.Equal("Bug", res.Data.Type);
            Assert.Equal("open", res.Data.Status);
            Assert.Equal("Alice", res.Data.AuthorName);
            Assert.Equal("The CTF server is not reachable from my machine", res.Data.Description);

            var ticketInDb = await ctx.Tickets.SingleAsync();
            Assert.Equal(user.Id, ticketInDb.AuthorId);
            Assert.Equal("Server down", ticketInDb.Title);
            Assert.Equal("Bug", ticketInDb.Type);
            Assert.Equal("open", ticketInDb.Status);
            Assert.False(ticketInDb.CreateAt == default);
        }
    }
}

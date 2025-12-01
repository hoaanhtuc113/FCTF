using System.Threading.Tasks;
using ContestantBE.Services;
using ResourceShared.Models;
using Xunit;

namespace UnitTest
{
    public class TicketService_DeleteTicket_Tests : TestBase
    {
        private TicketService CreateService(AppDbContext ctx) => new TicketService(ctx);

        [Fact]
        public async Task DeleteTicket_Fail_When_Ticket_Not_Found()
        {
            using var ctx = CreateContext(nameof(DeleteTicket_Fail_When_Ticket_Not_Found));
            ctx.Users.Add(new User { Id = 1, Name = "User1" });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.DeleteTicket(ticketId: 999, userId: 1);

            Assert.False(res.Success);
            Assert.Equal("Ticket not found", res.Message);
            Assert.False(res.Data);
        }

        [Fact]
        public async Task DeleteTicket_Fail_When_User_Not_Owner()
        {
            using var ctx = CreateContext(nameof(DeleteTicket_Fail_When_User_Not_Owner));

            var author = new User { Id = 1, Name = "Alice" };
            var other = new User { Id = 2, Name = "Bob" };
            ctx.Users.AddRange(author, other);

            ctx.Tickets.Add(new Ticket
            {
                Id = 10,
                AuthorId = author.Id,
                Title = "Ticket 10",
                Status = "open",
                ReplierMessage = null
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.DeleteTicket(ticketId: 10, userId: 2);

            Assert.False(res.Success);
            Assert.Equal("You don't have permission to delete this ticket", res.Message);
            Assert.False(res.Data);
        }

        [Fact]
        public async Task DeleteTicket_Fail_When_Ticket_Has_ReplierMessage()
        {
            using var ctx = CreateContext(nameof(DeleteTicket_Fail_When_Ticket_Has_ReplierMessage));

            var author = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(author);

            ctx.Tickets.Add(new Ticket
            {
                Id = 20,
                AuthorId = author.Id,
                Title = "Ticket 20",
                Status = "open",
                ReplierMessage = "Already replied"
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.DeleteTicket(ticketId: 20, userId: author.Id);

            Assert.False(res.Success);
            Assert.Equal("Cannot delete ticket that has been replied or closed", res.Message);
            Assert.False(res.Data);
            Assert.NotNull(await ctx.Tickets.FindAsync(20));
        }

        [Fact]
        public async Task DeleteTicket_Fail_When_Ticket_Status_Not_Open()
        {
            using var ctx = CreateContext(nameof(DeleteTicket_Fail_When_Ticket_Status_Not_Open));

            var author = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(author);

            ctx.Tickets.Add(new Ticket
            {
                Id = 30,
                AuthorId = author.Id,
                Title = "Ticket 30",
                Status = "Closed",
                ReplierMessage = null
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.DeleteTicket(ticketId: 30, userId: author.Id);

            Assert.False(res.Success);
            Assert.Equal("Cannot delete ticket that has been replied or closed", res.Message);
            Assert.False(res.Data);
            Assert.NotNull(await ctx.Tickets.FindAsync(30));
        }

        [Fact]
        public async Task DeleteTicket_Fail_When_Status_Null()
        {
            using var ctx = CreateContext(nameof(DeleteTicket_Fail_When_Status_Null));

            var author = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(author);

            ctx.Tickets.Add(new Ticket
            {
                Id = 40,
                AuthorId = author.Id,
                Title = "Ticket 40",
                Status = null,
                ReplierMessage = null
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.DeleteTicket(ticketId: 40, userId: author.Id);

            Assert.False(res.Success);
            Assert.Equal("Cannot delete ticket that has been replied or closed", res.Message);
            Assert.False(res.Data);
            Assert.NotNull(await ctx.Tickets.FindAsync(40));
        }

        [Fact]
        public async Task DeleteTicket_Success_When_Owner_Open_And_No_Reply()
        {
            using var ctx = CreateContext(nameof(DeleteTicket_Success_When_Owner_Open_And_No_Reply));

            var author = new User { Id = 1, Name = "Alice" };
            ctx.Users.Add(author);

            ctx.Tickets.Add(new Ticket
            {
                Id = 50,
                AuthorId = author.Id,
                Title = "Ticket 50",
                Status = "open",
                ReplierMessage = null
            });
            await ctx.SaveChangesAsync();

            var svc = CreateService(ctx);

            var res = await svc.DeleteTicket(ticketId: 50, userId: author.Id);

            Assert.True(res.Success);
            Assert.Equal("Ticket deleted successfully", res.Message);
            Assert.True(res.Data);
            Assert.Null(await ctx.Tickets.FindAsync(50));
        }
    }
}

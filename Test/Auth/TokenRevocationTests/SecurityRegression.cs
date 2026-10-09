using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using ContestantBE.RateLimiting;
using ContestantBE.Services;
using ContestantBE.Utils;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using ResourceShared.DTOs.Ticket;
using ResourceShared.Models;
using ResourceShared.Utils;
using StackExchange.Redis;

static class SecurityRegression
{
    private static void Check(bool value, string message)
    {
        if (!value) throw new InvalidOperationException(message);
    }

    public static async Task Run()
    {
        var tests = new (string Name, Func<Task> Run)[]
        {
            ("Login account budget survives rotating IPs and casing", async () =>
            {
                var f = new RateFixture();
                for (var i = 0; i < 5; i++)
                    Check((await f.Request("/api/auth/login-contestant", account: " USER-1 ", ip: $"192.0.2.{i+1}")).Response.StatusCode == 204, "Login denied too early");
                var blocked = await f.Request("/API/AUTH/LOGIN-CONTESTANT/", account: "user-1", ip: "192.0.2.99");
                Check(blocked.Response.StatusCode == 429 && int.Parse(blocked.Response.Headers.RetryAfter.ToString()) > 0, "Account limit bypassed");
                Check((await f.Request("/api/auth/login-contestant", account: "user-2")).Response.StatusCode == 204, "Another account incorrectly blocked");
                f.Advance(301);
                Check((await f.Request("/api/auth/login-contestant", account: "user-1")).Response.StatusCode == 204, "Window did not expire");
                Check(f.Keys.All(key => !key.Contains("user-1")), "Account leaked in Redis keys");
            }),
            ("Login IP budget also applies to many account names", async () =>
            {
                var f = new RateFixture();
                for (var i = 0; i < 100; i++)
                    Check((await f.Request("/api/auth/login-contestant", account: $"unknown-{i}")).Response.StatusCode == 204, "IP quota incorrect");
                Check((await f.Request("/api/auth/login-contestant", account: "another")).Response.StatusCode == 429, "IP quota bypassed");
            }),
            ("Password budget is per user across JWT rotation", async () =>
            {
                var f = new RateFixture();
                for (var i = 0; i < 5; i++)
                    Check((await f.Request("/api/auth/change-password", uuid: $"jwt-{i}")).Response.StatusCode == 204, "Password quota incorrect");
                var blocked = await f.Request("/api/auth/change-password", uuid: "new-jwt");
                Check(blocked.Response.StatusCode == 429 && blocked.Response.Headers.RetryAfter == "900", "Password quota bypassed");
                Check((await f.Request("/api/auth/change-password", id: 2)).Response.StatusCode == 204, "Another user blocked");
            }),
            ("Submission budget is shared across challenges and replicas", async () =>
            {
                var f = new RateFixture();
                await Task.WhenAll(Enumerable.Range(0, 30).Select(async i =>
                    Check((await f.Request("/api/challenge/attempt", account: $"challenge-{i}")).Response.StatusCode == 204, "Submission quota incorrect")));
                Check((await f.Request("/api/challenge/attempt")).Response.StatusCode == 429, "Submission quota bypassed");
                f.Advance(61);
                Check((await f.Request("/api/challenge/attempt")).Response.StatusCode == 204, "Submission window did not expire");
            }),
            ("Limiter fails closed and leaves normal routes unaffected", async () =>
            {
                var f = new RateFixture { Unavailable = true };
                Check((await f.Request("/api/challenge/attempt")).Response.StatusCode == 503, "Outage allowed sensitive action");
                Check((await f.Request("/api/auth/change-password", id: 0)).Response.StatusCode == 401, "Anonymous action allowed");
                Check((await f.Request("/api/challenge/list")).Response.StatusCode == 204, "Unrelated endpoint blocked");
                Check((await f.Request("/api/auth/login-contestant", method: "GET")).Response.StatusCode == 204, "GET blocked");
            }),
            ("Login preserves request body and rejects oversized or invalid JSON", async () =>
            {
                var f = new RateFixture();
                var allowed = await f.Request("/api/auth/login-contestant", account: "user-1");
                Check(allowed.Request.Body.Position == 0 && allowed.Request.Body.Length > 0, "MVC body consumed");
                Check((await f.Request("/api/auth/login-contestant", body: "{")).Response.StatusCode == 400, "Malformed JSON accepted");
                Check((await f.Request("/api/auth/login-contestant", body: new string('x', 8193))).Response.StatusCode == 413, "Oversized body accepted");
            }),
            ("Invalid tickets never write, valid ticket type is canonicalized", async () =>
            {
                await using var f = await Fixture.Create();
                var service = f.TicketService();
                foreach (var request in new[] {
                    new CreateTicketRequestDTO { title = "<script>alert(1)</script>", type = "Question", description = "Test" },
                    new CreateTicketRequestDTO { title = "A ticket", type = "INVALID", description = "Test" },
                    new CreateTicketRequestDTO { title = "Bad\nname", type = "Error", description = "Test" },
                    new CreateTicketRequestDTO { title = "A ticket", type = "Inform", description = new string('x', 4001) }
                }) Check(!(await service.CreateTicket(request, 1)).Success, "Invalid ticket saved");
                Check(await f.Db.Tickets.CountAsync() == 0, "Invalid data persisted");
                var valid = await service.CreateTicket(new CreateTicketRequestDTO {
                    title = "  Cannot connect  ", type = " question ", description = "Instance connection failed"
                }, 1);
                Check(valid.Success && valid.Data!.Type == "Question" && valid.Data.Title == "Cannot connect", "Valid ticket rejected");
                Check(valid.Data!.TeamName == "test-team", "Ticket response lost author team");
            }),
            ("Team member response does not disclose another member email", () =>
            {
                var user = new User { Id = 2, Name = "member", Email = "private@example.test" };
                var other = JsonSerializer.Serialize(TeamService.ToMemberDTO(user, 1, 100));
                Check(!other.Contains(user.Email), "Another member email leaked");
                Check(TeamService.ToMemberDTO(user, 2, 100).Email == user.Email, "Own email lost");
                Check(InputValidation.IsPlainName("Nguyễn Văn A") && !InputValidation.IsPlainName("<script>"), "Name validation incorrect");
                return Task.CompletedTask;
            })
        };
        foreach (var test in tests)
        {
            await test.Run();
            Console.WriteLine("PASS: " + test.Name);
        }
        Console.WriteLine($"Passed {tests.Length} additional security regression tests.");
    }

    sealed class RateFixture
    {
        private readonly Dictionary<string, (long Count, long Expires)> counters = new();
        private readonly Mock<IConnectionMultiplexer> redis = new();
        private long now;
        public bool Unavailable;
        public IEnumerable<string> Keys => counters.Keys;

        public RateFixture()
        {
            var db = new Mock<IDatabase>();
            db.Setup(d => d.ScriptEvaluateAsync(It.IsAny<string>(), It.IsAny<RedisKey[]>(), It.IsAny<RedisValue[]>(), It.IsAny<CommandFlags>()))
                .Returns((string script, RedisKey[] keys, RedisValue[] args, CommandFlags flags) =>
                {
                    if (Unavailable) return Task.FromException<RedisResult>(new InvalidOperationException("Redis unavailable"));
                    lock (counters)
                    {
                        var key = keys[0].ToString();
                        var entry = counters.GetValueOrDefault(key);
                        if (entry.Expires <= now) entry = (0, now + (long)args[0]);
                        counters[key] = (++entry.Count, entry.Expires);
                        return Task.FromResult(RedisResult.Create(new[] { RedisResult.Create(entry.Count), RedisResult.Create(entry.Expires - now) }));
                    }
                });
            redis.Setup(m => m.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(db.Object);
        }

        public void Advance(long seconds) => now += seconds;

        public async Task<HttpContext> Request(string path, int id = 1, string uuid = "jwt", string account = "test",
            string ip = "192.0.2.1", string method = "POST", string? body = null)
        {
            var context = new DefaultHttpContext();
            context.Request.Path = path;
            context.Request.Method = method;
            context.Connection.RemoteIpAddress = IPAddress.Parse(ip);
            context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body ?? JsonSerializer.Serialize(new { username = account, password = "wrong" })));
            context.Response.Body = new MemoryStream();
            if (id > 0) context.User = new ClaimsPrincipal(new ClaimsIdentity(new[] {
                new Claim(ClaimTypes.NameIdentifier, id.ToString()), new Claim("tokenUuid", uuid)
            }, "Bearer"));
            var middleware = new SensitiveRateLimitMiddleware(c => { c.Response.StatusCode = 204; return Task.CompletedTask; },
                NullLogger<SensitiveRateLimitMiddleware>.Instance);
            await middleware.InvokeAsync(context, redis.Object, new UserHelper(Options.Create(new ProxyOptions())));
            return context;
        }
    }
}

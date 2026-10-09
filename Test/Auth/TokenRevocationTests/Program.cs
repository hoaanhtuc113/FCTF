using System.Collections;
using System.Security.Claims;
using ContestantBE.Services;
using ContestantBE.Controllers;
using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Newtonsoft.Json;
using ResourceShared.DTOs.Auth;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Logger;
using ResourceShared.Middlewares;
using ResourceShared.Models;
using ResourceShared.Utils;
using ResourceShared.Services;
using DeploymentCenter.Services;
using StackExchange.Redis;

// Real service/middleware and relational persistence, with isolated SQLite and mocked Redis.
var tests = new (string Name, Func<Task> Run)[]
{
    ("Valid token works with a warm cache", async () =>
    {
        await using var f = await Fixture.Create();
        f.WarmCache("old-token");
        Check(await f.Request("old-token") == 204, "Valid token rejected");
    }),
    ("Revoked token is rejected despite a stale cache", async () =>
    {
        await using var f = await Fixture.Create();
        f.WarmCache("old-token");
        f.Db.Tokens.RemoveRange(await f.Db.Tokens.Where(t => t.UserId == 1).ToListAsync());
        await f.Db.SaveChangesAsync();
        Check(await f.Request("old-token") == 401, "Stale cache accepted revoked token");
        Check(f.NextCalls == 0, "Protected endpoint ran");
    }),
    ("Revoked token is rejected with Redis unavailable", async () =>
    {
        await using var f = await Fixture.Create();
        f.CacheUnavailable = true;
        f.Db.Tokens.RemoveRange(await f.Db.Tokens.Where(t => t.UserId == 1).ToListAsync());
        await f.Db.SaveChangesAsync();
        Check(await f.Request("old-token") == 401, "Revoked token accepted without Redis");
    }),
    ("A late cache write cannot restore a revoked token", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Tokens.RemoveRange(await f.Db.Tokens.Where(t => t.UserId == 1).ToListAsync());
        await f.Db.SaveChangesAsync();
        // Simulate an in-flight request repopulating Redis after reset invalidation.
        f.WarmCache("old-token");
        Check(await f.Request("old-token") == 401, "Late cache write restored revoked token");
    }),
    ("A valid new token works when the previous login remains cached", async () =>
    {
        await using var f = await Fixture.Create();
        f.WarmCache("old-token");
        (await f.Db.Tokens.FirstAsync(t => t.UserId == 1)).Value = "new-token";
        await f.Db.SaveChangesAsync();
        Check(await f.Request("old-token") == 401, "Previous token still works");
        Check(await f.Request("new-token") == 204, "New token rejected by stale cache");
    }),
    ("Password change revokes all sessions even if cache deletion fails", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Tokens.Add(new Token { UserId = 1, Type = "user", Value = "second-session" });
        await f.Db.SaveChangesAsync();
        f.WarmCache("old-token");
        f.CacheDeleteFails = true;
        var result = await f.Service().ChangePassword(1, Fixture.PasswordRequest());
        Check(result.Success, "Password change failed");
        Check(!await f.Db.Tokens.AnyAsync(t => t.UserId == 1), "Old sessions remain");
        Check(await f.Db.Tokens.AnyAsync(t => t.UserId == 2), "Other account affected");
        Check(SHA256Helper.VerifyPassword("NewPassword!456", (await f.Db.Users.FindAsync(1))!.Password!),
            "New password not saved");
        Check(await f.Request("old-token") == 401, "Old token survived password change");
        // TokenHelper is the same issuer used by the login endpoint.
        Environment.SetEnvironmentVariable("PRIVATE_KEY", new string('k', 64));
        var jwt = await new TokenHelper(f.Db).GenerateUserToken((await f.Db.Users.FindAsync(1))!);
        await f.Db.SaveChangesAsync();
        var uuid = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler()
            .ReadJwtToken(jwt).Claims.Single(c => c.Type == "tokenUuid").Value;
        Check(await f.Request(uuid) == 204, "Fresh login token rejected");
    }),
    ("Wrong password preserves password and tokens", async () =>
    {
        await using var f = await Fixture.Create();
        var request = Fixture.PasswordRequest();
        request.oldPassword = "WrongPassword!123";
        var result = await f.Service().ChangePassword(1, request);
        Check(!result.Success, "Wrong password accepted");
        Check(await f.Db.Tokens.AnyAsync(t => t.UserId == 1), "Token revoked on failed validation");
        Check(SHA256Helper.VerifyPassword("OldPassword!123", (await f.Db.Users.FindAsync(1))!.Password!),
            "Password changed on failed validation");
    }),
    ("A database failure rolls back both password and token deletion", async () =>
    {
        await using var f = await Fixture.Create();
        // Force the real relational transaction to fail after the DELETE but before UPDATE succeeds.
        await f.Db.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER fail_password_update BEFORE UPDATE OF Password ON Users
            BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;
            """);
        var result = await f.Service().ChangePassword(1, Fixture.PasswordRequest());
        Check(!result.Success, "Database failure reported success");
        f.Db.ChangeTracker.Clear();
        Check(await f.Db.Tokens.AnyAsync(t => t.UserId == 1), "Token deletion was committed on failure");
        Check(SHA256Helper.VerifyPassword("OldPassword!123", (await f.Db.Users.FindAsync(1))!.Password!),
            "Password was committed on failure");
    }),
    ("An unsupported flag type produces a controlled failed attempt", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Flags.Add(new Flag { ChallengeId = 99, Type = "invalid", Content = "FLAG{test}" });
        await f.Db.SaveChangesAsync();
        var result = await ChallengeHelper.Attempt(f.Db, new Challenge { Id = 99 },
            new ChallengeAttemptRequest { Submission = "FLAG{test}" });
        Check(!result.status && result.message?.Contains("unavailable") == true, "Unsupported flag accepted or unhandled");
    }),
    ("A NULL flag type produces a controlled failed attempt", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Flags.Add(new Flag { ChallengeId = 99, Type = null, Content = "FLAG{test}" });
        await f.Db.SaveChangesAsync();
        var result = await ChallengeHelper.Attempt(f.Db, new Challenge { Id = 99 },
            new ChallengeAttemptRequest { Submission = "FLAG{test}" });
        Check(!result.status && result.message?.Contains("unavailable") == true, "NULL flag type caused an invalid result");
    }),
    ("Static and regex flags still accept correct submissions", async () =>
    {
        await using var f = await Fixture.Create();
        var flag = new Flag { ChallengeId = 99, Type = "static", Content = "FLAG{test}" };
        f.Db.Flags.Add(flag);
        await f.Db.SaveChangesAsync();
        var challenge = new Challenge { Id = 99 };
        Check((await ChallengeHelper.Attempt(f.Db, challenge,
            new ChallengeAttemptRequest { Submission = "FLAG{test}" })).status, "Static flag rejected");
        Check(!(await ChallengeHelper.Attempt(f.Db, challenge,
            new ChallengeAttemptRequest { Submission = "wrong" })).status, "Wrong submission accepted");
        flag.Type = "regex";
        flag.Content = "FLAG\\{[a-z]+\\}";
        await f.Db.SaveChangesAsync();
        Check((await ChallengeHelper.Attempt(f.Db, challenge,
            new ChallengeAttemptRequest { Submission = "FLAG{test}" })).status, "Regex flag rejected");
    }),
    ("Dynamic formulas clamp safely and reject invalid configurations", () =>
    {
        var config = new DynamicChallenge { Initial = 100, Minimum = 10, Decay = 10, Function = "linear" };
        foreach (var count in new[] { 0, 1, 2, 1000000, int.MaxValue })
        {
            foreach (var function in new[] { "linear", "logarithmic" })
            {
                config.Function = function;
                var value = DynamicChallengeHelper.CalculateValue(config, count);
                Check(value >= 10 && value <= 100, "Score escaped bounds");
            }
        }
        config.Function = "linear";
        config.Initial = int.MaxValue;
        config.Decay = int.MaxValue;
        Check(DynamicChallengeHelper.CalculateValue(config, int.MaxValue) == 10, "Linear overflow");
        foreach (var invalid in new[] {
            new DynamicChallenge { Initial = -1, Minimum = 0, Decay = 1, Function = "linear" },
            new DynamicChallenge { Initial = 100, Minimum = 200, Decay = 1, Function = "linear" },
            new DynamicChallenge { Initial = 100, Minimum = 10, Decay = 0, Function = "linear" },
            new DynamicChallenge { Initial = 100, Minimum = 10, Decay = 1, Function = "unknown" },
            new DynamicChallenge { Initial = null, Minimum = 10, Decay = 1, Function = "linear" },
        })
        {
            var rejected = false;
            try { DynamicChallengeHelper.CalculateValue(invalid, 2); }
            catch (InvalidOperationException) { rejected = true; }
            Check(rejected, "Invalid config accepted");
        }
        return Task.CompletedTask;
    }),
    ("Dynamic scores count the configured account mode and visibility", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Challenges.Add(new Challenge { Id = 10, Type = "dynamic", Value = 100, State = "visible", ConnectionProtocol = "http",
            DynamicChallenge = new DynamicChallenge { Initial = 100, Minimum = 10, Decay = 10, Function = "linear" } });
        f.Db.Teams.Add(new Team { Id = 2, Hidden = true, Banned = false });
        (await f.Db.Teams.FindAsync(1))!.Hidden = false;
        (await f.Db.Users.FindAsync(2))!.TeamId = 2;
        f.Db.Configs.Add(new Config { Id = 1, Key = "user_mode", Value = "teams" });
        f.Db.Solves.AddRange(new Solf { Id = 1, UserId = 1, TeamId = 1, ChallengeId = 10 },
            new Solf { Id = 2, UserId = 2, TeamId = 2, ChallengeId = 10 });
        await f.Db.SaveChangesAsync();
        foreach (var (mode, hiddenTeam, hiddenUser, bannedTeam, expected) in new[] {
            ("teams", true, false, false, 100),
            ("users", true, false, false, 90),
            ("teams", false, true, false, 90),
            ("users", false, true, false, 100),
            ("teams", false, false, true, 100),
        })
        {
            (await f.Db.Configs.FindAsync(1))!.Value = mode;
            (await f.Db.Teams.FindAsync(2))!.Hidden = hiddenTeam;
            (await f.Db.Teams.FindAsync(2))!.Banned = bannedTeam;
            (await f.Db.Users.FindAsync(1))!.Hidden = hiddenUser;
            await f.Db.SaveChangesAsync();
            await using var tx = await f.Db.Database.BeginTransactionAsync();
            await DynamicChallengeHelper.LockChallengeForScoring(f.Db, 10);
            Check(await DynamicChallengeHelper.RecalculateDynamicChallengeValue(f.Db, 10) == expected,
                $"Wrong score for {mode}");
            await tx.CommitAsync();
            Check((await f.Db.Challenges.AsNoTracking().FirstAsync(c => c.Id == 10)).Value == expected,
                "Score not persisted");
        }
    }),
    ("Solve and recalculated score roll back together", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Challenges.Add(new Challenge { Id = 10, Type = "dynamic", Value = 100, State = "visible", ConnectionProtocol = "http",
            DynamicChallenge = new DynamicChallenge { Initial = 100, Minimum = 10, Decay = 10, Function = "linear" } });
        f.Db.Solves.Add(new Solf { Id = 1, UserId = 1, TeamId = 1, ChallengeId = 10 });
        await f.Db.SaveChangesAsync();
        await using (var tx = await f.Db.Database.BeginTransactionAsync())
        {
            await DynamicChallengeHelper.LockChallengeForScoring(f.Db, 10);
            f.Db.Solves.Add(new Solf { Id = 2, UserId = 2, TeamId = 2, ChallengeId = 10 });
            await f.Db.SaveChangesAsync();
            Check(await DynamicChallengeHelper.RecalculateDynamicChallengeValue(f.Db, 10) == 90, "Recalc failed");
            await tx.RollbackAsync();
        }
        Check(await f.Db.Solves.CountAsync() == 1, "Rolled back solve remains");
        Check((await f.Db.Challenges.AsNoTracking().FirstAsync(c => c.Id == 10)).Value == 100,
            "Rolled back value remains");
    }),
    ("Invalid stored config cannot commit a new solve", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Challenges.Add(new Challenge { Id = 10, Type = "dynamic", Value = 100, State = "visible", ConnectionProtocol = "http",
            DynamicChallenge = new DynamicChallenge { Initial = 100, Minimum = 200, Decay = 0, Function = "linear" } });
        await f.Db.SaveChangesAsync();
        await using (var tx = await f.Db.Database.BeginTransactionAsync())
        {
            await DynamicChallengeHelper.LockChallengeForScoring(f.Db, 10);
            f.Db.Solves.Add(new Solf { Id = 1, UserId = 1, TeamId = 1, ChallengeId = 10 });
            await f.Db.SaveChangesAsync();
            var rejected = false;
            try { await DynamicChallengeHelper.RecalculateDynamicChallengeValue(f.Db, 10); }
            catch (InvalidOperationException) { rejected = true; }
            Check(rejected, "Invalid config did not block scoring");
            await tx.RollbackAsync();
        }
        Check(await f.Db.Solves.CountAsync() == 0, "Failed recalc left a solve");
    }),

    ("Invalid regex and empty legacy flags are configuration errors", async () =>
    {
        await using var f = await Fixture.Create();
        foreach (var (kind, content) in new[] { ("regex", "["), ("static", (string?)null), ("invalid", "FLAG{test}") })
        {
            f.Db.Flags.RemoveRange(f.Db.Flags);
            f.Db.Flags.Add(new Flag { ChallengeId = 99, Type = kind, Content = content });
            await f.Db.SaveChangesAsync();
            var result = await ChallengeHelper.Attempt(f.Db, new Challenge { Id = 99 },
                new ChallengeAttemptRequest { Submission = "wrong" });
            Check(!result.status && result.configuration_error, "Broken flag was counted as an incorrect answer");
        }
    }),
    ("A valid alternative flag is accepted after a broken regex", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Flags.AddRange(new Flag { Id = 1, ChallengeId = 99, Type = "regex", Content = "[" },
            new Flag { Id = 2, ChallengeId = 99, Type = "static", Content = "FLAG{valid}" });
        await f.Db.SaveChangesAsync();
        var result = await ChallengeHelper.Attempt(f.Db, new Challenge { Id = 99 },
            new ChallengeAttemptRequest { Submission = "FLAG{valid}" });
        Check(result.status && !result.configuration_error, "Valid alternative blocked by broken flag");
    }),
    ("Attempt rejects missing IDs, empty submissions and unavailable users", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Challenges.Add(new Challenge { Id = 10, Type = "standard", Value = 100,
            State = "visible", ConnectionProtocol = "http" });
        await f.Db.SaveChangesAsync();
        var controller = f.ChallengeController();
        foreach (var id in new int?[] { null, 0, -1 })
            Check(await controller.Attempt(new ChallengeAttemptRequest { ChallengeId = id, Submission = "test" })
                is BadRequestObjectResult, "Invalid challenge ID not rejected");
        foreach (var submission in new string?[] { null, "", "  ", new string('x', 1001) })
            Check(await controller.Attempt(new ChallengeAttemptRequest { ChallengeId = 10, Submission = submission })
                is BadRequestObjectResult, "Invalid submission not rejected");
        Check(await f.ChallengeController(999).Attempt(new ChallengeAttemptRequest { ChallengeId = 10, Submission = "test" })
            is UnauthorizedObjectResult, "Missing account caused unhandled failure");
        var user = (await f.Db.Users.FindAsync(1))!;
        user.TeamId = null;
        user.Team = null;
        await f.Db.SaveChangesAsync();
        Check(await controller.Attempt(new ChallengeAttemptRequest { ChallengeId = 10, Submission = "test" })
            is ObjectResult { StatusCode: 403 }, "Missing team caused unhandled failure");
    }),
    ("A configuration error exits the controller before submission writes", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Challenges.Add(new Challenge { Id = 10, Type = "standard", Value = 100,
            State = "visible", ConnectionProtocol = "http" });
        f.Db.Flags.Add(new Flag { ChallengeId = 10, Type = "regex", Content = "[" });
        await f.Db.SaveChangesAsync();
        // Submission storage and lock services are deliberately absent in this fixture.
        // Reaching either write path would fail instead of returning this controlled error.
        var result = await f.ChallengeController().Attempt(new ChallengeAttemptRequest {
            ChallengeId = 10, Submission = "wrong"
        });
        Check(result is BadRequestObjectResult, "Invalid configuration reached the write path");
        Check(JsonConvert.SerializeObject(((BadRequestObjectResult)result).Value).Contains("\"status\":\"error\""),
            "Configuration fault was reported as an incorrect flag");
        Check(await f.Db.Solves.CountAsync() == 0, "Configuration fault created a solve");
    }),
    ("Challenge routing keeps named routes and HTTP methods distinct", async () =>
    {
        var builder = WebApplication.CreateBuilder(Array.Empty<string>());
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(ChallengeController).Assembly);
        await using var app = builder.Build();
        app.UseRouting();
        app.Use(async (context, next) => {
            var action = context.GetEndpoint()?.Metadata.GetMetadata<ControllerActionDescriptor>();
            if (action?.ControllerTypeInfo.AsType() == typeof(ChallengeController))
                await context.Response.WriteAsync(action.ActionName);
            else
                await next(context);
        });
        app.MapControllers().AllowAnonymous();
        await app.StartAsync();
        var address = app.Services.GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>().Features
            .Get<IServerAddressesFeature>()!.Addresses.Single();
        using var client = new HttpClient { BaseAddress = new Uri(address) };
        foreach (var (path, status, action) in new[] {
            ("1", 200, "GetById"),
            ("by-topic", 200, "GetByTopic"),
            ("list_challenge/Web", 200, "ListChallengesByCategoryName"),
            ("instances", 200, "GetAllInstances"),
            ("list_challenge/", 404, ""),
            ("check_cache", 404, ""),
            ("check-status", 405, ""),
            ("abc", 404, ""),
            ("0", 404, ""),
            ("-1", 404, ""),
        })
        {
            var response = await client.GetAsync("/api/challenge/" + path);
            Check((int)response.StatusCode == status, $"Unexpected status for {path}: {response.StatusCode}");
            if (status == 200)
                Check(await response.Content.ReadAsStringAsync() == action, $"Wrong route matched for {path}");
        }
        var post = await client.PostAsync("/api/challenge/check-status", new StringContent("{}"));
        Check((int)post.StatusCode == 200 && await post.Content.ReadAsStringAsync() == "CheckChallengeStatus",
            "POST check-status stopped matching");
        await app.StopAsync();
    }),
    ("Client activity log endpoints reject fake events", async () =>
    {
        var service = new Mock<IActionLogsServices>();
        var user = new Mock<IUserContext>();
        user.SetupGet(c => c.UserId).Returns(1);
        var controller = new ActionLogsController(user.Object, service.Object);
        var result = controller.SaveActionLogs(new ResourceShared.DTOs.ActionLogs.ActionLogsReq {
            ActionType = 2, ActionDetail = "Fake legitimate-looking start", ChallengeId = 10
        });
        Check(result is ObjectResult { StatusCode: 403 }, "Client could write a fake event");
        service.VerifyNoOtherCalls();
        await Task.CompletedTask;
    }),
    ("Server activity events return the saved ID and resolved topic", async () =>
    {
        await using var f = await Fixture.Create();
        f.Db.Challenges.Add(new Challenge { Id = 10, Category = "Web", State = "visible", ConnectionProtocol = "http" });
        await f.Db.SaveChangesAsync();
        var service = new ActionLogsServices(f.Db, new ConfigHelper(f.Db));
        var result = await service.SaveActionLogs(new ResourceShared.DTOs.ActionLogs.ActionLogsReq {
            ActionType = 2, ActionDetail = "Started challenge", ChallengeId = 10
        }, 1);
        Check(result.ActionId > 0 && result.TopicName == "Web", "Saved ID/topic omitted");
        Check(await f.Db.ActionLogs.CountAsync() == 1, "Event duplicated");
        foreach (var id in new int?[] { null, 999 })
        {
            var rejected = false;
            try { await service.SaveActionLogs(new ResourceShared.DTOs.ActionLogs.ActionLogsReq {
                ActionType = 2, ActionDetail = "Started challenge", ChallengeId = id
            }, 1); }
            catch (ArgumentException) { rejected = true; }
            Check(rejected, "Invalid event saved with a Null topic");
        }
        Check(await f.Db.ActionLogs.CountAsync() == 1, "Rejected event was written");
    }),
    ("Stop revokes Gateway access before namespace deletion", async () =>
    {
        await using var f = await Fixture.Create();
        f.Cache["deploy_challenge_10_1"] = JsonConvert.SerializeObject(new ChallengeDeploymentCacheDTO {
            _namespace = "old-route", time_finished = DateTimeOffset.UtcNow.ToUnixTimeSeconds()+3600,
            status = "Running", ready = true
        });
        f.RedisDatabase.Setup(d => d.ScriptEvaluateAsync(It.IsAny<string>(), It.IsAny<RedisKey[]>(),
            It.IsAny<RedisValue[]>(), It.IsAny<CommandFlags>())).ReturnsAsync(RedisResult.Create((RedisValue)1));
        f.K8s.Setup(k => k.DeleteNamespace("old-route")).Returns(() => {
            Check(f.Cache.ContainsKey("fctf:gateway:revoked:old-route"), "Deleted before revocation");
            return Task.FromResult(true);
        });
        var result = await f.DeployService().Stop(new ChallengeStartStopReqDTO { challengeId = 10, teamId = 1, userId = 1 });
        Check(result.success && result.status == 200, "Stop failed");
        f.K8s.Verify(k => k.DeleteNamespace("old-route"), Times.Once);
    }),
    ("A failed namespace deletion is reported after revocation", async () =>
    {
        await using var f = await Fixture.Create();
        f.Cache["deploy_challenge_10_1"] = JsonConvert.SerializeObject(new ChallengeDeploymentCacheDTO {
            _namespace = "old-route", time_finished = DateTimeOffset.UtcNow.ToUnixTimeSeconds()+3600,
            status = "Running", ready = true
        });
        f.RedisDatabase.Setup(d => d.ScriptEvaluateAsync(It.IsAny<string>(), It.IsAny<RedisKey[]>(),
            It.IsAny<RedisValue[]>(), It.IsAny<CommandFlags>())).ReturnsAsync(RedisResult.Create((RedisValue)1));
        f.K8s.Setup(k => k.DeleteNamespace("old-route")).ReturnsAsync(false);
        var result = await f.DeployService().Stop(new ChallengeStartStopReqDTO { challengeId = 10, teamId = 1, userId = 1 });
        Check(!result.success && result.status == 503, "Delete failure reported success");
        Check(f.Cache.ContainsKey("fctf:gateway:revoked:old-route"), "Failed delete restored access");
    }),
    ("Redis failure prevents a successful stop acknowledgement", async () =>
    {
        await using var f = await Fixture.Create();
        f.Cache["deploy_challenge_10_1"] = JsonConvert.SerializeObject(new ChallengeDeploymentCacheDTO {
            _namespace = "old-route", time_finished = DateTimeOffset.UtcNow.ToUnixTimeSeconds()+3600
        });
        f.CacheUnavailable = true;
        // GET must work to reach the independent revocation write failure.
        f.RedisDatabase.Setup(d => d.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .Returns((RedisKey key, CommandFlags _) => Task.FromResult(f.Cache.GetValueOrDefault(key.ToString(), RedisValue.Null)));
        var result = await f.DeployService().Stop(new ChallengeStartStopReqDTO { challengeId = 10, teamId = 1, userId = 1 });
        Check(!result.success, "Stop accepted without revocation");
        f.K8s.Verify(k => k.DeleteNamespace(It.IsAny<string>()), Times.Never);
    }),
    ("Stop all cannot proceed without reading Gateway sessions", async () =>
    {
        await using var f = await Fixture.Create();
        // No reachable multiplexer: enumeration must fail, not look like zero sessions.
        var result = await f.DeployService().StopAll();
        Check(!result.Success, "Stop all accepted an unreadable deployment cache");
        f.K8s.Verify(k => k.DeleteAllChallengeNamespaces(It.IsAny<string>()), Times.Never);
    }),
    ("Gateway tokens bind to the deployment cache key", () =>
    {
        Environment.SetEnvironmentVariable("PRIVATE_KEY", new string('k',64));
        var value = ChallengeHelper.GenerateChallengeToken("route", DateTimeOffset.UtcNow.AddMinutes(10), "deploy_challenge_10_1");
        var encoded = value.Split('.')[0].Replace('-','+').Replace('_','/');
        encoded = encoded.PadRight((encoded.Length+3)/4*4,'=');
        var payload = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
        Check(payload.Contains("\"deployment_key\":\"deploy_challenge_10_1\""), "Token missing session binding");
        return Task.CompletedTask;
    }),
};

foreach (var test in tests)
{
    await test.Run();
    Console.WriteLine($"PASS: {test.Name}");
}
Console.WriteLine($"Passed {tests.Length} auth, flag, scoring and competition flow regression tests.");
await SecurityRegression.Run();
await AdminApiRegression.Run();
await BracketValidationRegression.Run();
await ApiInputValidationRegression.Run();

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

sealed class Fixture : IAsyncDisposable
{
    private readonly SqliteConnection connection;
    private readonly ServiceProvider services;
    public readonly TestDbContext Db;
    public readonly Dictionary<string, RedisValue> Cache = new();
    public bool CacheUnavailable;
    public bool CacheDeleteFails;
    public int NextCalls;
    private readonly RedisHelper redis;
    public readonly Mock<IDatabase> RedisDatabase;
    public readonly Mock<IConnectionMultiplexer> RedisMultiplexer;
    public readonly Mock<IK8sService> K8s = new();

    private Fixture(SqliteConnection connection)
    {
        this.connection = connection;
        Db = new TestDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        services = new ServiceCollection()
            .AddSingleton(new AppLogger(NullLogger<AppLogger>.Instance))
            .BuildServiceProvider();
        var database = new Mock<IDatabase>();
        RedisDatabase = database;
        database.Setup(d => d.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .Returns((RedisKey key, CommandFlags _) => CacheUnavailable
                ? Task.FromException<RedisValue>(new InvalidOperationException("Redis unavailable"))
                : Task.FromResult(Cache.GetValueOrDefault(key.ToString(), RedisValue.Null)));
        database.Setup(d => d.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .Returns((RedisKey key, CommandFlags _) => CacheDeleteFails
                ? Task.FromException<bool>(new InvalidOperationException("Cache deletion failed"))
                : Task.FromResult(Cache.Remove(key.ToString())));
        database.Setup(d => d.StringSetAsync(It.IsAny<RedisKey>(), It.IsAny<RedisValue>(),
                It.IsAny<TimeSpan?>(), It.IsAny<bool>(), It.IsAny<When>(), It.IsAny<CommandFlags>()))
            .Returns((RedisKey key, RedisValue value, TimeSpan? expiry, bool keepTtl, When when, CommandFlags flags) =>
            {
                if (CacheUnavailable) return Task.FromException<bool>(new InvalidOperationException("Redis unavailable"));
                Cache[key.ToString()] = value;
                return Task.FromResult(true);
            });
        var multiplexer = new Mock<IConnectionMultiplexer>();
        RedisMultiplexer = multiplexer;
        multiplexer.Setup(m => m.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(database.Object);
        database.SetupGet(d => d.Multiplexer).Returns(multiplexer.Object);
        redis = new RedisHelper(multiplexer.Object);
    }

    public static async Task<Fixture> Create()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var f = new Fixture(connection);
        await f.Db.Database.EnsureCreatedAsync();
        f.Db.Teams.Add(new Team { Id = 1, Name = "test-team", Banned = false });
        for (var id = 1; id <= 2; id++)
        {
            f.Db.Users.Add(new User {
                Id = id, Name = $"user-{id}", TeamId = 1, Type = "user", Verified = true,
                Banned = false, Hidden = false, Password = SHA256Helper.HashPasswordPythonStyle("OldPassword!123")
            });
            f.Db.Tokens.Add(new Token {
                UserId = id, Type = "user", Value = id == 1 ? "old-token" : "unaffected-token",
                Expiration = DateTime.UtcNow.AddDays(1)
            });
        }
        await f.Db.SaveChangesAsync();
        return f;
    }

    public static ChangePasswordDTO PasswordRequest() => new() {
        oldPassword = "OldPassword!123", newPassword = "NewPassword!456", confirmPassword = "NewPassword!456"
    };

    public AuthService Service() => new(Db, null!, null!, null!, null!,
        services.GetRequiredService<AppLogger>(), redis, null!, null!);

    public DeployService DeployService() => new(Db, redis, K8s.Object, services.GetRequiredService<AppLogger>(), null!);
    public TicketService TicketService() => new(Db, services.GetRequiredService<AppLogger>());
    public ChallengeService InstancesService() => new(Db, redis, null!, new ConfigHelper(Db),
        services.GetRequiredService<AppLogger>(), null!);

    public ChallengeController ChallengeController(int userId = 1)
    {
        var userContext = new Mock<IUserContext>();
        userContext.SetupGet(c => c.UserId).Returns(userId);
        userContext.SetupGet(c => c.TeamId).Returns(1);
        return new ChallengeController(userContext.Object, Db, new ConfigHelper(Db), null!, null!,
            redis, null!, services.GetRequiredService<AppLogger>(), null!, null!,
            services.GetRequiredService<IServiceScopeFactory>()) {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
    }

    public void WarmCache(string uuid) => Cache["auth:user:1"] = JsonConvert.SerializeObject(new {
        TokenValueFromDb = uuid, TeamId = 1, Verified = true, Banned = false, Hidden = false, TeamBanned = false
    });

    public async Task<int> Request(string uuid)
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        context.User = new ClaimsPrincipal(new ClaimsIdentity(new[] {
            new Claim(ClaimTypes.NameIdentifier, "1"), new Claim("teamId", "1"), new Claim("tokenUuid", uuid)
        }, "Bearer"));
        context.SetEndpoint(new Endpoint(_ => Task.CompletedTask,
            new EndpointMetadataCollection(new AuthorizeAttribute()), "protected"));
        var middleware = new TokenAuthenticationMiddleware(c => {
            NextCalls++;
            c.Response.StatusCode = 204;
            return Task.CompletedTask;
        }, services.GetRequiredService<IServiceScopeFactory>());
        await middleware.InvokeAsync(context, Db, redis);
        return context.Response.StatusCode;
    }

    public async ValueTask DisposeAsync()
    {
        await Db.DisposeAsync();
        await connection.DisposeAsync();
        await services.DisposeAsync();
    }
}

sealed class TestDbContext(DbContextOptions<AppDbContext> options) : AppDbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Keep only entities used by these tests; other mappings require MySQL.
        var entities = new[] { typeof(User), typeof(Token), typeof(Team), typeof(Flag), typeof(Challenge), typeof(DynamicChallenge), typeof(Solf), typeof(Config), typeof(ActionLog), typeof(Ticket), typeof(Bracket) };
        foreach (var property in typeof(AppDbContext).GetProperties())
        {
            var type = property.PropertyType;
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(DbSet<>)
                && !entities.Contains(type.GenericTypeArguments[0]))
                modelBuilder.Ignore(type.GenericTypeArguments[0]);
        }
        foreach (var type in entities)
        {
            var entity = modelBuilder.Entity(type);
            entity.HasKey(type == typeof(ActionLog) ? "ActionId" : "Id");
            foreach (var property in type.GetProperties())
            {
                if (property.PropertyType != typeof(string)
                    && (typeof(IEnumerable).IsAssignableFrom(property.PropertyType)
                        || entities.Contains(property.PropertyType)))
                    entity.Ignore(property.Name);
            }
        }
        modelBuilder.Entity<User>().HasOne(u => u.Team).WithMany().HasForeignKey(u => u.TeamId);
        modelBuilder.Entity<ActionLog>().HasOne(a => a.User).WithMany().HasForeignKey(a => a.UserId);
        modelBuilder.Entity<Flag>().Ignore(f => f.Challenge);
        modelBuilder.Entity<Challenge>().ToTable("challenges");
        modelBuilder.Entity<Challenge>().HasOne(c => c.DynamicChallenge).WithOne(d => d.IdNavigation)
            .HasForeignKey<DynamicChallenge>(d => d.Id);
        modelBuilder.Entity<Solf>().HasIndex(s => new { s.ChallengeId, s.UserId }).IsUnique();
        modelBuilder.Entity<Solf>().HasIndex(s => new { s.ChallengeId, s.TeamId }).IsUnique();
    }
}

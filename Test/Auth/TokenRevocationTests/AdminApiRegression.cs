using System.Net;
using ContestantBE.Controllers;
using ContestantBE.Interfaces;
using ContestantBE.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Newtonsoft.Json;
using ResourceShared.DTOs.Challenge;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Utils;
using StackExchange.Redis;

static class AdminApiRegression
{
    static void Check(bool value, string message)
    {
        if (!value) throw new InvalidOperationException(message);
    }

    public static async Task Run()
    {
        await TestLogs();
        await TestTickets();
        await TestInstances();
        Console.WriteLine("Passed 3 additional admin/API regression tests.");
    }

    static async Task TestLogs()
    {
        await using var f = await Fixture.Create();
        f.Db.Teams.Add(new Team { Id = 2, Name = "other" });
        f.Db.Users.Add(new User { Id = 3, Name = "outsider", TeamId = 2 });
        f.Db.Configs.Add(new Config { Key = "hidden_categories", Value = " Hidden " });
        for (var i = 1; i <= 5; i++) f.Db.ActionLogs.Add(new ActionLog {
            ActionId = i, UserId = 1, ActionType = 2, ActionDate = new DateTime(2026, 1, 1),
            ActionDetail = "Started", TopicName = "Web"
        });
        f.Db.ActionLogs.AddRange(new ActionLog {
            ActionId = 6, UserId = 1, ActionType = 3, ActionDetail = "Solved", TopicName = "Other"
        }, new ActionLog {
            ActionId = 7, UserId = 1, ActionType = 2, ActionDetail = "Hidden", TopicName = "hidden"
        }, new ActionLog {
            ActionId = 8, UserId = 3, ActionType = 2, ActionDetail = "Other team", TopicName = "Web"
        });
        await f.Db.SaveChangesAsync();
        var service = new ActionLogsServices(f.Db, new ConfigHelper(f.Db));
        var first = await service.GetActionLogsTeamPage(1, 1, 2, "STARTED", 2, "Web");
        var second = await service.GetActionLogsTeamPage(1, 2, 2, "STARTED", 2, "Web");
        Check(first.Total == 5 && first.Logs.Select(x => x.ActionId).SequenceEqual(new[] {5,4}), "Log count/order incorrect");
        Check(second.Logs.Select(x => x.ActionId).SequenceEqual(new[] {3,2}), "Pages overlap");
        Check(first.Topics.SequenceEqual(new[] {"Other", "Web"}), "Topics include hidden or lose off-page options");
        var all = await service.GetActionLogsTeamPage(1, 1, 100, null, null, null);
        Check(all.Total == 6 && all.Logs.All(x => x.ActionId < 7), "Hidden/other-team logs leaked");
        Check((await service.GetActionLogsTeamPage(1, 9, 2, null, null, null)).Logs.Count == 0, "Out-of-range page not empty");
        var user = new Mock<IUserContext>(); user.SetupGet(x => x.TeamId).Returns(1);
        var controller = new ActionLogsController(user.Object, service);
        Check(await controller.GetActionLogsTeam(page: 0) is BadRequestObjectResult, "Invalid page accepted");
        Check(await controller.GetActionLogsTeam(pageSize: 101) is BadRequestObjectResult, "Oversized page accepted");
        Check(await controller.GetActionLogsTeam(perPage: 1, pageSize: 2) is BadRequestObjectResult, "Conflicting aliases accepted");
        var result = (OkObjectResult)await controller.GetActionLogsTeam(pageSize: 2);
        var json = Newtonsoft.Json.Linq.JObject.FromObject(result.Value!);
        Check(json["data"]!.Count() == 2 && (int)json["meta"]!["pagination"]!["total"]! == 6, "pageSize alias ignored");
        Console.WriteLine("PASS: Team log pagination, filters, visibility and stable ordering");
    }

    static async Task TestTickets()
    {
        await using var f = await Fixture.Create();
        f.Db.Tickets.Add(new Ticket { Id = 1, AuthorId = 2, Title = "Test", Type = "Question", Status = "open", Description = "Test" });
        await f.Db.SaveChangesAsync();
        var user = new Mock<IUserContext>(); user.SetupGet(x => x.UserId).Returns(1);
        var controller = new TicketController(user.Object, f.TicketService(), new AppLogger(NullLogger<AppLogger>.Instance));
        Check(await controller.GetTicketById(1) is ObjectResult { StatusCode: 403 }, "Forbidden GET is not 403");
        Check(await controller.DeleteTicket(1) is ObjectResult { StatusCode: 403 }, "Forbidden DELETE is not 403");
        Check(await f.Db.Tickets.CountAsync() == 1, "Forbidden request changed ticket");
        Check(await controller.GetTicketById(999) is ObjectResult { StatusCode: 404 }, "Missing GET not 404");
        Check(await controller.DeleteTicket(999) is ObjectResult { StatusCode: 404 }, "Missing DELETE not 404");
        user.SetupGet(x => x.UserId).Returns(2);
        Check(await controller.GetTicketById(1) is OkObjectResult, "Owner cannot read ticket");
        Check(await controller.DeleteTicket(1) is OkObjectResult, "Owner cannot delete ticket");
        Console.WriteLine("PASS: Ticket owner/forbidden/not-found statuses and no unauthorized mutation");
    }

    static async Task TestInstances()
    {
        await using var f = await Fixture.Create();
        f.Db.Challenges.Add(new Challenge { Id = 10, Name = "Instance", Category = "Web", State = "visible", ConnectionProtocol = "http" });
        await f.Db.SaveChangesAsync();
        var server = new Mock<IServer>();
        var endpoint = new IPEndPoint(IPAddress.Loopback, 6379);
        f.RedisMultiplexer.Setup(m => m.GetEndPoints(It.IsAny<bool>())).Returns(new EndPoint[] { endpoint });
        f.RedisMultiplexer.Setup(m => m.GetServer(It.IsAny<EndPoint>(), It.IsAny<object>())).Returns(server.Object);
        server.SetupGet(s => s.IsConnected).Returns(true);
        server.Setup(s => s.Keys(It.IsAny<int>(), It.IsAny<RedisValue>(), It.IsAny<int>(), It.IsAny<long>(), It.IsAny<int>(), It.IsAny<CommandFlags>()))
            .Returns(new RedisKey[] { "deploy_challenge_10_1" });
        long expiry = 1791134111;
        f.RedisDatabase.Setup(d => d.StringGetAsync(It.IsAny<RedisKey[]>(), It.IsAny<CommandFlags>()))
            .Returns(() => Task.FromResult(new RedisValue[] { JsonConvert.SerializeObject(new ChallengeDeploymentCacheDTO {
                challenge_id = 10, team_id = 1, time_finished = expiry, ready = true, status = "Running"
            }) }));
        var instances = await f.InstancesService().GetAllInstances(1);
        Check(instances.Count == 1 && instances[0].expires_at == expiry && instances[0].age == expiry.ToString(), "Expiry mapping/compatibility wrong");
        expiry = -1;
        Check((await f.InstancesService().GetAllInstances(1))[0].expires_at == null, "Unlimited instance has a fake expiry");
        foreach (var value in new long[] { -1, 0 }) {
            expiry = value;
            var unlimited = (await f.InstancesService().GetAllInstances(1))[0];
            Check(unlimited.expires_at == null && unlimited.age == "-1", "Legacy expiration alias is inconsistent");
        }
        Console.WriteLine("PASS: Instance expiry is explicit; legacy field retained; unlimited expiry is null");
    }
}

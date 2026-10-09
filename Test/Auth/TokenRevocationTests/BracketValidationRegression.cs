using ContestantBE.Controllers;
using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Newtonsoft.Json.Linq;
using ResourceShared.Models;
using ResourceShared.Utils;

static class BracketValidationRegression
{
    public static async Task Run()
    {
        await using var f = await Fixture.Create();
        f.Db.Configs.Add(new Config { Key = "score_visibility", Value = "public" });
        f.Db.Brackets.AddRange(
            new Bracket { Id = 1, Name = "Team bracket", Type = "teams" },
            new Bracket { Id = 2, Name = "User bracket", Type = "users" },
            new Bracket { Id = 3, Name = null, Type = "teams" },
            new Bracket { Id = 4, Name = "", Type = "users" },
            new Bracket { Id = 5, Name = "   ", Type = "teams" },
            new Bracket { Id = 6, Name = "Unknown", Type = "invalid_type" },
            new Bracket { Id = 7, Name = "Missing type", Type = null });
        await f.Db.SaveChangesAsync();
        var controller = new ScoreboardController(new Mock<IUserContext>().Object,
            new Mock<IScoreboardService>().Object, new ConfigHelper(f.Db), f.Db);
        var result = (OkObjectResult)await controller.GetBrackets();
        var data = JObject.FromObject(result.Value!)["data"]!;
        if (!data.Select(x => (int)x["Id"]!).SequenceEqual(new[] { 1, 2 }))
            throw new InvalidOperationException("BE-109: Invalid legacy brackets reached the scoreboard");
        if (await f.Db.Brackets.CountAsync() != 7)
            throw new InvalidOperationException("BE-109: Filtering modified legacy rows");
        Console.WriteLine("PASS: BE-109 scoreboard excludes legacy brackets with blank names or invalid types");
    }
}

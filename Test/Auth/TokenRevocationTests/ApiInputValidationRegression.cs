using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Ticket;

static class ApiInputValidationRegression
{
    public static async Task Run()
    {
        await using var fixture = await Fixture.Create();
        var service = fixture.TicketService();
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        foreach (var value in new object?[] { 999999, 1, null, "abc" })
        {
            var json = JsonSerializer.Serialize(new {
                title = "Cannot connect", type = "Question",
                description = "Instance connection failed", challenge_id = value
            });
            var request = JsonSerializer.Deserialize<CreateTicketRequestDTO>(json, options)!;
            if (request.AdditionalFields?.ContainsKey("challenge_id") != true)
                throw new InvalidOperationException("Unsupported challenge_id was discarded during binding");
            if ((await service.CreateTicket(request, 1)).Success)
                throw new InvalidOperationException("Ticket accepted an unsupported challenge relation");
        }
        if (await fixture.Db.Tickets.CountAsync() != 0)
            throw new InvalidOperationException("Invalid ticket requests wrote data");
        var valid = JsonSerializer.Deserialize<CreateTicketRequestDTO>(
            "{\"title\":\"Cannot connect\",\"type\":\"Question\",\"description\":\"Instance connection failed\"}", options)!;
        if (!(await service.CreateTicket(valid, 1)).Success || await fixture.Db.Tickets.CountAsync() != 1)
            throw new InvalidOperationException("Supported ticket request failed");
        Console.WriteLine("PASS: BE-124 rejects unsupported challenge_id before writes and preserves valid tickets");
    }
}

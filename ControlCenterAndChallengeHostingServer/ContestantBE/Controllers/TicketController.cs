using ContestantBE.Attribute;
using ContestantBE.Interfaces;
using ContestantBE.Utils;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.Ticket;
using ResourceShared.Logger;

namespace ContestantBE.Controllers;

[Authorize]
public class TicketController : BaseController
{
    private readonly ITicketService _ticketService;
    private readonly AppLogger _userBehaviorLogger;

    public TicketController(
        IUserContext userContext,
        ITicketService ticketService,
        AppLogger userBehaviorLogger) : base(userContext)
    {
        _ticketService = ticketService;
        _userBehaviorLogger = userBehaviorLogger;
    }

    [HttpPost("sendticket")]
    [DuringCtfTimeOnly]
    public async Task<IActionResult> CreateTicketByUser([FromBody] CreateTicketRequestDTO request)
    {
        var userId = UserContext.UserId;
        _userBehaviorLogger.Log("CREATE_TICKET", userId, UserContext.TeamId, new { request.title, request.description });
        await Console.Out.WriteLineAsync($"[Requesst Send Ticket] User {userId}: Title {request.title}, message {request.description}");

        var result = await _ticketService.CreateTicket(request, userId);
        if (!result.Success) return BadRequest(new { message = result.Message });
        return Created("", result.Data);
    }

    [HttpGet("tickets-user")]
    [DuringCtfTimeOnly]
    public async Task<IActionResult> GetTicketByUser()
    {
        var userId = UserContext.UserId;
        _userBehaviorLogger.Log("GET_TICKETS_BY_USER", userId, UserContext.TeamId, null);
        var tickets = await _ticketService.GetTicketsByUser(userId);
        return Ok(new { tickets });
    }

    [HttpGet("tickets/{ticketId}")]
    [DuringCtfTimeOnly]
    public async Task<IActionResult> GetTicketById(int ticketId)
    {
        var userId = UserContext.UserId;

        _userBehaviorLogger.Log("GET_TICKET_BY_ID", userId, UserContext.TeamId, new { ticket_id = ticketId });
        var result = await _ticketService.GetTicketById(ticketId, userId);

        if (!result.Success)
        {
            // Check if it's a permission issue based on the message
            if (result.Message.Contains("permission"))
                return StatusCode(401, new { message = result.Message });

            return NotFound(new { message = result.Message });
        }

        return Ok(result);
    }

    [HttpDelete("tickets/{ticketId}")]
    [DuringCtfTimeOnly]
    public async Task<IActionResult> DeleteTicket(int ticketId)
    {
        var userId = UserContext.UserId;
        _userBehaviorLogger.Log("DELETE_TICKET", userId, UserContext.TeamId, new { ticket_id = ticketId });
        await Console.Out.WriteLineAsync($"[Requesst Remove Ticket] User {userId}: Ticket ID {ticketId}");
        var result = await _ticketService.DeleteTicket(ticketId, userId);
        if (!result.Success) return BadRequest(new { message = result.Message });

        return Ok(new { message = result.Message });
    }
}

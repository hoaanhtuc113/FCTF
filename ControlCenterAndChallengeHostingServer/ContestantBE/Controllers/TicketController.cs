using ContestantBE.Attribute;
using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.Ticket;
using ResourceShared.Logger;
using System.Security.Claims;

namespace ContestantBE.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class TicketController : ControllerBase
{
    private readonly ITicketService _ticketService;
    private readonly AppLogger _userBehaviorLogger;

    public TicketController(ITicketService ticketService, AppLogger userBehaviorLogger)
    {
        _ticketService = ticketService;
        _userBehaviorLogger = userBehaviorLogger;
    }

    [HttpPost("sendticket")]
    [DuringCtfTimeOnly]
    public async Task<IActionResult> CreateTicketByUser([FromBody] CreateTicketRequestDTO request)
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));
        _userBehaviorLogger.Log("CREATE_TICKET", userId, int.Parse(User.FindFirstValue("teamId")), new { title = request.title, description = request.description });
        await Console.Out.WriteLineAsync($"[Requesst Send Ticket] User {userId}: Title {request.title}, message {request.description}");

        var result = await _ticketService.CreateTicket(request, userId);
        if (!result.Success) return BadRequest(new { message = result.Message });
        return Created("", result.Data);
    }

    [HttpGet("tickets-user")]
    [DuringCtfTimeOnly]
    public async Task<IActionResult> GetTicketByUser()
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));
        _userBehaviorLogger.Log("GET_TICKETS_BY_USER", userId, int.Parse(User.FindFirstValue("teamId")), null); 
        var tickets = await _ticketService.GetTicketsByUser(userId);
        return Ok(new { tickets });
    }

    [HttpGet("tickets/{ticketId}")]
    [DuringCtfTimeOnly]
    public async Task<IActionResult> GetTicketById(int ticketId)
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));

        _userBehaviorLogger.Log("GET_TICKET_BY_ID", userId, int.Parse(User.FindFirstValue("teamId")), new { ticket_id = ticketId });    
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

    // [HttpGet("tickets")]
    // [DuringCtfTimeOnly]
    // public async Task<IActionResult> GetAllTickets([FromQuery] int? userId, [FromQuery] string? status,
    //     [FromQuery] string? type, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int per_page = 10)
    // {
    //     var result = await _ticketService.GetAllTickets(userId, status, type, search, page, per_page);
    //     return Ok(result);
    // }

    [HttpDelete("tickets/{ticketId}")]
    [DuringCtfTimeOnly]
    public async Task<IActionResult> DeleteTicket(int ticketId)
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));
        _userBehaviorLogger.Log("DELETE_TICKET", userId, int.Parse(User.FindFirstValue("teamId")), new { ticket_id = ticketId });
        await Console.Out.WriteLineAsync($"[Requesst Remove Ticket] User {userId}: Ticket ID {ticketId}");
        var result = await _ticketService.DeleteTicket(ticketId, userId);
        if (!result.Success) return BadRequest(new { message = result.Message });
        
        return Ok(new { message = result.Message });
    }
}

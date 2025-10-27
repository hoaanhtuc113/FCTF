using ContestantService.Attribute;
using ContestantService.Extensions;
using ContestantService.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Team;
using ResourceShared.DTOs.Ticket;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [RequireAuth]
    public class TicketController : ControllerBase
    {
        private readonly ITicketService _ticketService;

        public TicketController(ITicketService ticketService)
        {
            _ticketService = ticketService;
        }

        [HttpPost("sendticket")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> CreateTicketByUser([FromBody] CreateTicketRequestDTO request)
        {
            var token = HttpContext.Request.Headers["Authorization"].FirstOrDefault()?.Replace("Bearer ", "");
            var result = await _ticketService.CreateTicket(request, token);
            if (!result.Success) return BadRequest(new { message = result.Message });
            return Created("", result.Data);
        }

        [HttpGet("tickets-user")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetTicketByUser()
        {
            var user = HttpContext.GetCurrentUser();
            if (user == null) return Unauthorized(new { message = "Unauthorized" });

            var tickets = await _ticketService.GetTicketsByUser(user);
            return Ok(new { tickets });
        }

        [HttpGet("tickets/{ticketId}")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetTicketById(int ticketId)
        {
            var ticket = await _ticketService.GetTicketById(ticketId);
            if (ticket == null) return NotFound(new { message = "Ticket not found" });
            return Ok(ticket);
        }

        [HttpGet("tickets")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetAllTickets([FromQuery] int? userId, [FromQuery] string? status,
            [FromQuery] string? type, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int per_page = 10)
        {
            var result = await _ticketService.GetAllTickets(userId, status, type, search, page, per_page);
            return Ok(result);
        }
    }
}

using ContestantBE.Attribute;
using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Attribute;
using ResourceShared.DTOs.Team;
using ResourceShared.DTOs.Ticket;
using ResourceShared.Extensions;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.Security.Claims;

namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
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
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));

            var tickets = await _ticketService.GetTicketsByUser(userId);
            return Ok(new { tickets });
        }

        [HttpGet("tickets/{ticketId}")]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetTicketById(int ticketId)
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));

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

            var result = await _ticketService.DeleteTicket(ticketId, userId);
            if (!result.Success) return BadRequest(new { message = result.Message });
            
            return Ok(new { message = result.Message });
        }
    }
}

using ContestantService.Extensions;
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
    public class TicketController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly CtfTimeHelper _ctfTimeHelper;
        private readonly ConfigHelper _configHelper;
        private readonly ScoreHelper _scoreHelper;
        public TicketController(AppDbContext context, CtfTimeHelper ctfTimeHelper, ConfigHelper configHelper, ScoreHelper scoreHelper)
        {
            _context = context;
            _ctfTimeHelper = ctfTimeHelper;
            _configHelper = configHelper;
            _scoreHelper = scoreHelper;
        }

        [HttpPost("sendticket")]
        public async Task<IActionResult> CreateTicketByUser([FromBody] CreateTicketRequestDTO request)
        {
            try
            {
                var generatedToken = HttpContext.Request.Headers["Authorization"]
                    .FirstOrDefault()?.Replace("Bearer ", "");

                if (string.IsNullOrEmpty(generatedToken))
                {
                    return BadRequest(new { error = "generatedToken is required" });
                }

                var token = _context.Tokens.FirstOrDefault(t => t.Value == generatedToken);
                if (token == null)
                {
                    return NotFound(new { error = "Token not found" });
                }

                var user = _context.Users.FirstOrDefault(u => u.Id == token.UserId);
                if (user == null)
                {
                    return NotFound(new { error = "User not found" });
                }

                if (string.IsNullOrWhiteSpace(request.title) ||
                    string.IsNullOrWhiteSpace(request.type) ||
                    string.IsNullOrWhiteSpace(request.description))
                {
                    return BadRequest(new { message = "Missing information" });
                }

                var newTicket = new Ticket
                {
                    AuthorId = user.Id,
                    Title = request.title,
                    Type = request.type,
                    Description = request.description,
                    CreateAt = DateTime.UtcNow,
                    Status = "open"
                };

                var userTickets = _context.Tickets
                    .Where(t => t.AuthorId == newTicket.AuthorId)
                    .ToList();

                foreach (var ticket in userTickets)
                {
                    double similarity = StringSimilarity(ticket.Description, newTicket.Description);
                    if (similarity >= 0.3)
                    {
                        return BadRequest(new
                        {
                            message = "You have already sent a similar ticket",
                            status = false
                        });
                    }
                }

                _context.Tickets.Add(newTicket);
                await _context.SaveChangesAsync();

                return StatusCode(201, new
                {
                    message = "Send ticket successfully",
                    status = true
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    message = "An unexpected error occurred",
                    error = ex.Message
                });
            }
        }

        [HttpGet("tickets-user")]
        public async Task<IActionResult> GetTicketByUser()
        {
            try
            {
                User user = HttpContext.GetCurrentUser();
                if (user == null)
                {
                    return Unauthorized(new { message = "Unauthorized" });
                }

                // Join tickets với author và replier
                var tickets = await (from t in _context.Tickets
                                     join a in _context.Users on t.AuthorId equals a.Id
                                     join r in _context.Users on t.ReplierId equals r.Id into replierJoin
                                     from r in replierJoin.DefaultIfEmpty() // outer join
                                     where t.AuthorId == user.Id
                                     select new
                                     {
                                         author_name = a.Name,
                                         status = t.Status,
                                         id = t.Id,
                                         title = t.Title,
                                         type = t.Type,
                                         date = t.CreateAt,
                                         description = t.Description,
                                         replier_name = r != null ? r.Name : null,
                                         replier_message = t.ReplierMessage
                                     }).ToListAsync();

                return Ok(new { tickets });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new
                {
                    message = "An error occurred while retrieving tickets",
                    error = ex.Message
                });
            }

        }

        [HttpGet("tickets/{ticketId}")]
        public async Task<IActionResult> GetTicketById(int ticketId)
        {
            try
            {
                var ticket = await (from t in _context.Tickets
                                    join a in _context.Users on t.AuthorId equals a.Id
                                    join r in _context.Users on t.ReplierId equals r.Id into replierJoin
                                    from r in replierJoin.DefaultIfEmpty()
                                    where t.Id == ticketId
                                    select new
                                    {
                                        id = t.Id,
                                        author_name = a.Name,
                                        status = t.Status,
                                        title = t.Title,
                                        date = t.CreateAt,
                                        type = t.Type,
                                        description = t.Description,
                                        replier_name = r != null ? r.Name : null,
                                        replier_message = t.ReplierMessage
                                    }).FirstOrDefaultAsync();

                if (ticket == null)
                {
                    return NotFound(new { message = "Ticket not found" });
                }

                return Ok(new { ticket });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new
                {
                    message = "An error occurred while retrieving ticket",
                    error = ex.Message
                });
            }
        }

        [HttpGet("tickets")]
        public async Task<IActionResult> GetAllTickets(
                                                        [FromQuery] int? userId,
                                                        [FromQuery] string? status,
                                                        [FromQuery] string? type,
                                                        [FromQuery] string? search,
                                                        [FromQuery] int page = 1,
                                                        [FromQuery] int per_page = 10)
        {
            try
            {
                var query = from t in _context.Tickets
                            join a in _context.Users on t.AuthorId equals a.Id
                            join r in _context.Users on t.ReplierId equals r.Id into replierJoin
                            from r in replierJoin.DefaultIfEmpty()
                            join team in _context.Teams on a.TeamId equals team.Id into teamJoin
                            from team in teamJoin.DefaultIfEmpty()
                            select new
                            {
                                ticket = t,
                                author_name = a.Name,
                                replier_name = r != null ? r.Name : null,
                                team_name = team != null ? team.Name : null
                            };

                // Filtering
                if (userId.HasValue)
                    query = query.Where(x => x.ticket.AuthorId == userId.Value);

                if (!string.IsNullOrEmpty(status))
                    query = query.Where(x => x.ticket.Status.Contains(status));

                if (!string.IsNullOrEmpty(type))
                    query = query.Where(x => x.ticket.Type.Contains(type));

                if (!string.IsNullOrEmpty(search))
                    query = query.Where(x => x.ticket.Title.Contains(search));

                var total = await query.CountAsync();

                var tickets = await query
                    .OrderByDescending(x => x.ticket.CreateAt)
                    .Skip((page - 1) * per_page)
                    .Take(per_page)
                    .ToListAsync();

                var tickets_data = tickets.Select(x => new
                {
                    author_name = x.author_name,
                    team_name = x.team_name,
                    status = x.ticket.Status,
                    id = x.ticket.Id,
                    title = x.ticket.Title,
                    type = x.ticket.Type,
                    date = x.ticket.CreateAt,
                    description = x.ticket.Description,
                    replier_name = x.replier_name,
                    replier_message = x.ticket.ReplierMessage
                });

                return Ok(new { tickets = tickets_data, total });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new
                {
                    message = "An error occurred while retrieving tickets",
                    error = ex.Message
                });
            }
        }



        /// <summary>
        ///  Python SequenceMatcher
        /// </summary>
        private double StringSimilarity(string s1, string s2)
        {
            if (string.IsNullOrEmpty(s1) || string.IsNullOrEmpty(s2)) return 0.0;

            int maxLen = Math.Max(s1.Length, s2.Length);
            if (maxLen == 0) return 1.0;

            int distance = LevenshteinDistance(s1, s2);
            return 1.0 - (double)distance / maxLen;
        }

        private int LevenshteinDistance(string s, string t)
        {
            int[,] d = new int[s.Length + 1, t.Length + 1];

            for (int i = 0; i <= s.Length; i++) d[i, 0] = i;
            for (int j = 0; j <= t.Length; j++) d[0, j] = j;

            for (int i = 1; i <= s.Length; i++)
            {
                for (int j = 1; j <= t.Length; j++)
                {
                    int cost = (s[i - 1] == t[j - 1]) ? 0 : 1;
                    d[i, j] = Math.Min(
                        Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1),
                        d[i - 1, j - 1] + cost
                    );
                }
            }

            return d[s.Length, t.Length];
        }





    }
}

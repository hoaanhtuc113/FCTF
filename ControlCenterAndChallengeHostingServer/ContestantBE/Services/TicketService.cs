namespace ContestantBE.Services
{
    using ContestantBE.Interfaces;
    using Microsoft.EntityFrameworkCore;
    using ResourceShared.DTOs;
    using ResourceShared.DTOs.Ticket;
    using ResourceShared.Models;

    public class TicketService : ITicketService
    {
        private readonly AppDbContext _context;

        public TicketService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<BaseResponseDTO<TicketResponseDTO>> CreateTicket(CreateTicketRequestDTO request, string? tokenValue)
        {
            if (string.IsNullOrEmpty(tokenValue))
                return BaseResponseDTO<TicketResponseDTO>.Fail("generatedToken is required");
            

            var token = await _context.Tokens.FirstOrDefaultAsync(t => t.Value == tokenValue);
            if (token == null) return BaseResponseDTO<TicketResponseDTO>.Fail("Token not found");

            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == token.UserId);
            if (user == null) return BaseResponseDTO<TicketResponseDTO>.Fail("User not found");

            if (string.IsNullOrWhiteSpace(request.title) ||
                string.IsNullOrWhiteSpace(request.type) ||
                string.IsNullOrWhiteSpace(request.description))
            {
                return BaseResponseDTO<TicketResponseDTO>.Fail("Missing information");
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

            // Check similarity
            var userTickets = await _context.Tickets.Where(t => t.AuthorId == user.Id).ToListAsync();
            foreach (var ticket in userTickets)
            {
                double similarity = StringSimilarity(ticket.Description, newTicket.Description);
                if (similarity >= 0.3)
                    return BaseResponseDTO<TicketResponseDTO>.Fail("You have already sent a similar ticket");
            }

            _context.Tickets.Add(newTicket);
            await _context.SaveChangesAsync();
            return BaseResponseDTO<TicketResponseDTO>.Ok(MapToDto(newTicket, user.Name, null, null), "Send ticket successfully");
        }

        public async Task<List<TicketResponseDTO>> GetTicketsByUser(User user)
        {
            return await (from t in _context.Tickets
                          join a in _context.Users on t.AuthorId equals a.Id
                          join r in _context.Users on t.ReplierId equals r.Id into replierJoin
                          from r in replierJoin.DefaultIfEmpty()
                          where t.AuthorId == user.Id
                          select new TicketResponseDTO
                          {
                              Id = t.Id,
                              AuthorName = a.Name,
                              Status = t.Status,
                              Title = t.Title,
                              Type = t.Type,
                              Date = t.CreateAt ?? DateTime.MinValue,
                              Description = t.Description,
                              ReplierName = r != null ? r.Name : null,
                              ReplierMessage = t.ReplierMessage
                          }).ToListAsync();
        }

        public async Task<TicketResponseDTO?> GetTicketById(int ticketId)
        {
            return await (from t in _context.Tickets
                          join a in _context.Users on t.AuthorId equals a.Id
                          join r in _context.Users on t.ReplierId equals r.Id into replierJoin
                          from r in replierJoin.DefaultIfEmpty()
                          where t.Id == ticketId
                          select new TicketResponseDTO
                          {
                              Id = t.Id,
                              AuthorName = a.Name,
                              Status = t.Status,
                              Title = t.Title,
                              Type = t.Type,
                              Date = t.CreateAt ?? DateTime.MinValue,
                              Description = t.Description,
                              ReplierName = r != null ? r.Name : null,
                              ReplierMessage = t.ReplierMessage
                          }).FirstOrDefaultAsync();
        }

        public async Task<PaginatedTicketsDTO> GetAllTickets(int? userId, string? status, string? type, string? search, int page, int perPage)
        {
            var query = from t in _context.Tickets
                        join a in _context.Users on t.AuthorId equals a.Id
                        join r in _context.Users on t.ReplierId equals r.Id into replierJoin
                        from r in replierJoin.DefaultIfEmpty()
                        join team in _context.Teams on a.TeamId equals team.Id into teamJoin
                        from team in teamJoin.DefaultIfEmpty()
                        select new { t, a, r, team };

            if (userId.HasValue)
                query = query.Where(x => x.t.AuthorId == userId.Value);

            if (!string.IsNullOrEmpty(status))
                query = query.Where(x => x.t.Status.Contains(status));

            if (!string.IsNullOrEmpty(type))
                query = query.Where(x => x.t.Type.Contains(type));

            if (!string.IsNullOrEmpty(search))
                query = query.Where(x => x.t.Title.Contains(search));

            var total = await query.CountAsync();

            var tickets = await query
                .OrderByDescending(x => x.t.CreateAt)
                .Skip((page - 1) * perPage)
                .Take(perPage)
                .Select(x => new TicketResponseDTO
                {
                    Id = x.t.Id,
                    AuthorName = x.a.Name,
                    TeamName = x.team != null ? x.team.Name : null,
                    Status = x.t.Status,
                    Title = x.t.Title,
                    Type = x.t.Type,
                    Date = (DateTime)x.t.CreateAt,
                    Description = x.t.Description,
                    ReplierName = x.r != null ? x.r.Name : null,
                    ReplierMessage = x.t.ReplierMessage
                })
                .ToListAsync();

            return new PaginatedTicketsDTO { Tickets = tickets, Total = total };
        }

        private TicketResponseDTO MapToDto(Ticket ticket, string authorName, string? replierName, string? teamName)
        {
            return new TicketResponseDTO
            {
                Id = ticket.Id,
                AuthorName = authorName,
                TeamName = teamName,
                Status = ticket.Status,
                Title = ticket.Title,
                Type = ticket.Type,
                Date = ticket.CreateAt ?? DateTime.MinValue,
                Description = ticket.Description,
                ReplierName = replierName,
                ReplierMessage = ticket.ReplierMessage
            };
        }

        // Utilities (Levenshtein + Similarity)
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
                    d[i, j] = Math.Min(Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1), d[i - 1, j - 1] + cost);
                }
            }
            return d[s.Length, t.Length];
        }
    }
}

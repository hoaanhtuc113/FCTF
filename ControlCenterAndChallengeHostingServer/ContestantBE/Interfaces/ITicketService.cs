using ResourceShared.DTOs;
using ResourceShared.DTOs.Ticket;
using ResourceShared.Models;

namespace ContestantBE.Interfaces
{
    public interface ITicketService
    {
        Task<BaseResponseDTO<TicketResponseDTO>> CreateTicket(CreateTicketRequestDTO request, string? tokenValue);
        Task<List<TicketResponseDTO>> GetTicketsByUser(User user);
        Task<TicketResponseDTO?> GetTicketById(int ticketId);
        Task<PaginatedTicketsDTO> GetAllTickets(int? userId, string? status, string? type, string? search, int page, int perPage);
    }
}

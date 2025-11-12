using ResourceShared.DTOs;
using ResourceShared.DTOs.Ticket;
using ResourceShared.Models;

namespace ContestantBE.Interfaces
{
    public interface ITicketService
    {
        Task<BaseResponseDTO<TicketResponseDTO>> CreateTicket(CreateTicketRequestDTO request, string? tokenValue);
        Task<List<TicketResponseDTO>> GetTicketsByUser(int user);
        Task<BaseResponseDTO<TicketResponseDTO>> GetTicketById(int ticketId, int userId);
        Task<PaginatedTicketsDTO> GetAllTickets(int? userId, string? status, string? type, string? search, int page, int perPage);
        Task<BaseResponseDTO<bool>> DeleteTicket(int ticketId, int userId);
    }
}

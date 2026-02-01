using ResourceShared.DTOs;
using ResourceShared.DTOs.Ticket;

namespace ContestantBE.Interfaces;

public interface ITicketService
{
    Task<BaseResponseDTO<TicketResponseDTO>> CreateTicket(CreateTicketRequestDTO request, int user);
    Task<List<TicketResponseDTO>> GetTicketsByUser(int user);
    Task<BaseResponseDTO<TicketResponseDTO>> GetTicketById(int ticketId, int userId);
    Task<PaginatedTicketsDTO> GetAllTickets(int? userId, string? status, string? type, string? search, int page, int perPage);
    Task<BaseResponseDTO<bool>> DeleteTicket(int ticketId, int userId);
}

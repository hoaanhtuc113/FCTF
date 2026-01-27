using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Notification;
using ResourceShared.Models;
using ResourceShared.Logger;

namespace ContestantBE.Services
{
    public interface INotificationServices
    {
        Task<List<NotificationDTO>> GetAll();
    }

    public class NotificationServices : INotificationServices
    {

        private readonly AppDbContext _context;
        private readonly AppLogger _logger;

        public NotificationServices(AppDbContext context, AppLogger logger)
        {
            _context = context;
            _logger = logger;
        }

        public async Task<List<NotificationDTO>> GetAll()
        {
            try
            {
                var notifications = await _context.Notifications.ToListAsync();
                var data = notifications.Select(n => new NotificationDTO
                {
                    Id = n.Id,
                    Content = n.Content,
                    Title = n.Title,
                    Date = n.Date,
                    User_id = n.UserId,
                    User = n.User,
                    Team_id = n.TeamId,
                    Team = n.Team,
                    html = n.Content,
                });

                return data.ToList();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex);
                return new List<NotificationDTO>();
            }
        }
    }
}

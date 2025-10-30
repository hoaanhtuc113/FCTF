using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Notification;
using ResourceShared.Models;

namespace ContestantBE.Services
{
    public interface INotificationServices
    {
        Task<List<NotificationDTO>> GetAll();
    }

    public class NotificationServices : INotificationServices
    {

        private AppDbContext _context;

        public NotificationServices(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<NotificationDTO>> GetAll()
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
    }
}

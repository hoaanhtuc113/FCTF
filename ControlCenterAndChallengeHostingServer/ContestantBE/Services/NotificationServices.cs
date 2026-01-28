using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Notification;
using ResourceShared.Models;
using ResourceShared.Logger;

namespace ContestantBE.Services;

public interface INotificationServices
{
    Task<List<NotificationDTO>> GetAll();
}

public class NotificationServices : INotificationServices
{

    private readonly AppDbContext _context;

    public NotificationServices(AppDbContext context)
    {
        _context = context;
    }

    public Task<List<NotificationDTO>> GetAll()
    {
        return _context.Notifications
            .AsNoTracking()
            .Select(n => new NotificationDTO
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
            })
            .Take(20)
            .OrderByDescending(n => n.Date)
            .ToListAsync();
    }
}

using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.ActionLogs;
using ResourceShared.Models;

namespace ContestantBE.Services
{
    public interface IActionLogsServices
    {
        Task<List<ActionLogsDTO>> GetActionLogs();
        Task<List<ActionLogsDTO>> GetActionLogsTeam(int teamId);
        Task<ActionLogsDTO> SaveActionLogs(ActionLogsReq req, int userId);
    }
    public class ActionLogsServices : IActionLogsServices
    {
        private readonly AppDbContext _context;

        public ActionLogsServices(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<ActionLogsDTO>> GetActionLogs()
        {
            var data = await _context.ActionLogs
                .AsNoTracking()
                .Include(al => al.User)
                .OrderByDescending(x => x.ActionDate)
                .Select(al => new ActionLogsDTO
                {
                    ActionId = al.ActionId,
                    ActionType = al.ActionType,
                    ActionDate = al.ActionDate,
                    ActionDetail = al.ActionDetail,
                    TopicName = al.TopicName,
                    UserId = al.UserId,
                    UserName = al.User != null ? al.User.Name : ""
                })
                .ToListAsync();

            return data;
        }
        public async Task<List<ActionLogsDTO>> GetActionLogsTeam(int teamId)
        {
            var data = await _context.ActionLogs
                .AsNoTracking()
                .Include(al => al.User)
                .Where(al => al.User != null && al.User.TeamId == teamId)
                .OrderByDescending(x => x.ActionDate)
                .Select(al => new ActionLogsDTO
                {
                    ActionId = al.ActionId,
                    ActionType = al.ActionType,
                    ActionDate = al.ActionDate,
                    ActionDetail = al.ActionDetail,
                    TopicName = al.TopicName,
                    UserId = al.UserId,
                    UserName = al.User != null ? al.User.Name : ""
                })
                .ToListAsync();

            return data;
        }

        public async Task<ActionLogsDTO> SaveActionLogs(ActionLogsReq req, int userId)
        {
            var topic_name = await _context.Challenges
                .AsNoTracking()
                .Where(c => c.Id == req.ChallengeId)
                .Select(c => c.Category)
                .FirstOrDefaultAsync();

            var log = new ActionLog
            {
                ActionType = req.ActionType,
                ActionDetail = req.ActionDetail,
                ActionDate = DateTime.UtcNow,
                UserId = userId,
                TopicName = topic_name ?? "Null",
            };
            _context.ActionLogs.Add(log);
            await _context.SaveChangesAsync();

            var username = await _context.Users
                .AsNoTracking()
                .Where(u => u.Id == userId)
                .Select(u => u.Name)
                .FirstOrDefaultAsync();

            return new ActionLogsDTO
            {
                ActionType = log.ActionType,
                ActionDate = log.ActionDate,
                ActionDetail = log.ActionDetail,
                TopicName = log.TopicName,
                UserId = log.UserId,
                UserName = username
            };
        }
    }
}

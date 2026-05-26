using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.ActionLogs;
using ResourceShared.Models;

namespace ContestantBE.Services;

public interface IActionLogsServices
{
    Task<List<ActionLogsDTO>> GetActionLogs();
    Task<List<ActionLogsDTO>> GetActionLogsTeam(int teamId, int contestId);
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
            .OrderByDescending(x => x.Date)
            .Select(al => new ActionLogsDTO
            {
                ActionId = al.Id,
                ActionType = al.Type,
                ActionDate = al.Date,
                ActionDetail = al.Detail,
                TopicName = al.TopicName,
                UserId = al.UserId,
                UserName = al.User != null ? al.User.Name : ""
            })
            .ToListAsync();

        return data;
    }

    public async Task<List<ActionLogsDTO>> GetActionLogsTeam(int teamId, int contestId)
    {
        var userIds = await _context.UserTeamMembers
            .AsNoTracking()
            .Where(m => m.TeamId == teamId)
            .Select(m => (int?)m.UserId)
            .ToListAsync();

        var data = await _context.ActionLogs
            .AsNoTracking()
            .Include(al => al.User)
            .Where(al => al.UserId != null && userIds.Contains(al.UserId) && al.ContestId == contestId)
            .OrderByDescending(x => x.Date)
            .Select(al => new ActionLogsDTO
            {
                ActionId = al.Id,
                ActionType = al.Type,
                ActionDate = al.Date,
                ActionDetail = al.Detail,
                TopicName = al.TopicName,
                UserId = al.UserId,
                UserName = al.User != null ? al.User.Name : ""
            })
            .ToListAsync();

        return data;
    }

    public async Task<ActionLogsDTO> SaveActionLogs(ActionLogsReq req, int userId)
    {
        var challengeInfo = await _context.Challenges
            .AsNoTracking()
            .Where(c => c.Id == req.ChallengeId)
            .Select(c => new { c.Category, c.ContestId })
            .FirstOrDefaultAsync();

        var log = new ActionLog
        {
            Type = req.ActionType,
            Detail = req.ActionDetail,
            Date = DateTime.UtcNow,
            UserId = userId,
            TopicName = challengeInfo?.Category ?? "Null",
            ContestId = challengeInfo?.ContestId,
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
            ActionId = log.Id,
            ActionType = log.Type,
            ActionDate = log.Date,
            ActionDetail = log.Detail,
            TopicName = log.TopicName,
            UserId = log.UserId,
            UserName = username
        };
    }
}

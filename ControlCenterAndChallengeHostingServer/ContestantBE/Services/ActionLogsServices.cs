using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.ActionLogs;
using ResourceShared.Models;

namespace ContestantBE.Services;

public interface IActionLogsServices
{
    Task<List<ActionLogsDTO>> GetActionLogs();
    Task<List<ActionLogsDTO>> GetActionLogsTeam(int teamId);
    Task<(List<ActionLogsDTO> Logs, int Total, List<string> Topics)> GetActionLogsTeamPage(
        int teamId, int page, int perPage, string? q, int? actionType, string? topic);
    Task<ActionLogsDTO> SaveActionLogs(ActionLogsReq req, int userId);
}
public class ActionLogsServices : IActionLogsServices
{
    private readonly AppDbContext _context;
    private readonly ResourceShared.Utils.ConfigHelper _configHelper;

    public ActionLogsServices(AppDbContext context, ResourceShared.Utils.ConfigHelper configHelper)
    {
        _context = context;
        _configHelper = configHelper;
    }

    public async Task<List<ActionLogsDTO>> GetActionLogs()
    {
        var hiddenCategories = _configHelper.HiddenCategories();

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

        data = data
            .Where(al => !hiddenCategories.Contains((al.TopicName ?? string.Empty).Trim()))
            .ToList();

        return data;
    }
    public async Task<List<ActionLogsDTO>> GetActionLogsTeam(int teamId)
        => (await GetActionLogsTeamPage(teamId, 1, 50, null, null, null)).Logs;

    public async Task<(List<ActionLogsDTO> Logs, int Total, List<string> Topics)> GetActionLogsTeamPage(
        int teamId, int page, int perPage, string? q, int? actionType, string? topic)
    {
        if (page < 1 || perPage < 1 || perPage > 100 || (long)(page - 1) * perPage > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(page));
        var hiddenCategories = _configHelper.HiddenCategories();
        var query = _context.ActionLogs
            .AsNoTracking()
            .Where(al => al.User != null && al.User.TeamId == teamId)
            .Where(al => !hiddenCategories.Select(x => x.ToLower()).Contains((al.TopicName ?? "").Trim().ToLower()));
        var topics = await query.Select(al => al.TopicName ?? "").Distinct().OrderBy(x => x).ToListAsync();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var search = q.Trim().ToLowerInvariant();
            query = query.Where(al => (al.ActionDetail ?? "").ToLower().Contains(search)
                || (al.User!.Name ?? "").ToLower().Contains(search) || (al.TopicName ?? "").ToLower().Contains(search));
        }
        if (actionType.HasValue) query = query.Where(al => al.ActionType == actionType.Value);
        if (topic != null) query = query.Where(al => al.TopicName == topic);
        var total = await query.CountAsync();
        var data = await query.OrderByDescending(x => x.ActionDate).ThenByDescending(x => x.ActionId)
            .Skip((page - 1) * perPage).Take(perPage)
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

        return (data, total, topics);
    }

    public async Task<ActionLogsDTO> SaveActionLogs(ActionLogsReq req, int userId)
    {
        if (req.ActionType < 1 || req.ActionType > 7 || string.IsNullOrWhiteSpace(req.ActionDetail) || req.ActionDetail.Length > 255)
            throw new ArgumentException("Invalid activity event");
        if (req.ChallengeId is not > 0 || !await _context.Challenges.AnyAsync(c => c.Id == req.ChallengeId))
            throw new ArgumentException("Activity challenge does not exist");
        if (!await _context.Users.AnyAsync(u => u.Id == userId))
            throw new ArgumentException("Activity user does not exist");
        var topic_name = req.ChallengeId.HasValue
            ? await _context.Challenges
                .AsNoTracking()
                .Where(c => c.Id == req.ChallengeId.Value)
                .Select(c => c.Category)
                .FirstOrDefaultAsync()
            : null;

        var log = new ActionLog
        {
            ActionType = req.ActionType,
            ActionDetail = req.ActionDetail,
            ActionDate = DateTime.UtcNow,
            UserId = userId,
            TopicName = topic_name,
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
            ActionId = log.ActionId,
            ActionType = log.ActionType,
            ActionDate = log.ActionDate,
            ActionDetail = log.ActionDetail,
            TopicName = log.TopicName,
            UserId = log.UserId,
            UserName = username
        };
    }
}

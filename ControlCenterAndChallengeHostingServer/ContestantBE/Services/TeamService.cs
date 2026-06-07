using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Team;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace ContestantBE.Services;

public class TeamService : ITeamService
{
    private readonly AppDbContext _context;
    private readonly ScoreHelper _scoreHelper;
    private readonly AppLogger _logger;

    public TeamService(
        AppDbContext context,
        ScoreHelper scoreHelper,
        AppLogger logger)
    {
        _context = context;
        _scoreHelper = scoreHelper;
        _logger = logger;
    }

    public async Task<TeamScoreDTO?> GetTeamScore(int userId, int contestId)
    {
        try
        {
            var team = await _context.Teams
                .AsNoTracking()
                .Include(t => t.Members).ThenInclude(m => m.User)
                .FirstOrDefaultAsync(t => t.ContestId == contestId && t.Members.Any(m => m.UserId == userId));
            var bracketId = team?.BracketId;
            if (team == null) return null;

            var teamUsers = team.Members.Select(m => m.User).ToList();
            var usersScore = await _scoreHelper.GetUsersScore(teamUsers, true, contestId);

            var members = new List<TeamMemberDTO>();
            foreach (var u in teamUsers)
            {
                _ = usersScore.TryGetValue(u, out int score);
                members.Add(new TeamMemberDTO
                {
                    Name = u.Name ?? string.Empty,
                    Email = u.Email ?? string.Empty,
                    Score = score
                });
            }

            var challenges = await _context.Challenges
                .AsNoTracking()
                .Where(c => c.ContestId == contestId && c.State == "visible")
                .Select(c => new { c.Value })
                .ToListAsync();

            var totalTeamsQuery = _context.Teams
                .AsNoTracking()
                .Where(t => t.ContestId == contestId && t.Banned == false && t.Hidden == false);
            if (bracketId.HasValue)
                totalTeamsQuery = totalTeamsQuery.Where(t => t.BracketId == bracketId.Value);
            var totalTeams = await totalTeamsQuery.CountAsync();

            return new TeamScoreDTO
            {
                Name = team.Name ?? string.Empty,
                Place = await _scoreHelper.GetTeamPlace(team, true, bracketId, contestId),
                Members = members,
                Score = await _scoreHelper.GetTeamScore(team, true, contestId),
                ChallengeTotalScore = challenges.Sum(c => c.Value ?? 0),
                TotalTeams = totalTeams,
                IsCaptain = team.CaptainUserId == userId
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId);
            return null;
        }
    }

    public async Task<List<SubmissionDto>> GetTeamSolves(int userId, int contestId)
    {
        try
        {
            var team = await _context.Teams
                .AsNoTracking()
                .Include(t => t.Members).ThenInclude(m => m.User)
                .FirstOrDefaultAsync(t => t.ContestId == contestId && t.Members.Any(m => m.UserId == userId));

            if (team == null) return [];

            return [.. (await _scoreHelper.GetTeamSolves(team, true, contestId))
                .Select(s => new SubmissionDto
                {
                    Id = s.Id,
                    ChallengeId = s.ChallengeId,
                    Challenge = new ChallengeDto
                    {
                        Id = s?.Challenge?.Id ?? default,
                        Name = s?.Challenge?.Name ?? string.Empty,
                        Category = s?.Challenge?.Category ?? string.Empty,
                        Value = s?.Challenge?.Value
                    },
                    User = new UserDto
                    {
                        Id = s?.User?.Id ?? default,
                        Name = s?.User?.Name ?? string.Empty
                    },
                    Team = new TeamDto
                    {
                        Id = team.Id,
                        Name = team.Name ?? string.Empty,
                    },
                    Date = s.IdNavigation.Date,
                    Type = s.IdNavigation.Type,
                    Provided = null,
                    Ip = null
                })];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId);
            return [];
        }
    }
}

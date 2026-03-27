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

    public async Task<TeamScoreDTO?> GetTeamScore(int userId)
    {
        try
        {
            var team = await _context.Teams
                .AsNoTracking()
                .Include(t => t.Users)
                .FirstOrDefaultAsync(t => t.Users.Any(u => u.Id == userId));
            var bracketId = team?.BracketId;
            if (team == null) return null;

            var usersScore = await _scoreHelper.GetUsersScore(team.Users, true);

            var members = new List<TeamMemberDTO>();
            foreach (var u in team.Users)
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
                .Where(c => c.State == "visible")
                .Select(c => new { c.Value })
                .ToListAsync();

            var totalTeamsQuery = _context.Teams
                .AsNoTracking()
                .Where(t => t.Banned == false && t.Hidden == false);
            if (bracketId.HasValue)
                totalTeamsQuery = totalTeamsQuery.Where(t => t.BracketId == bracketId.Value);
            var totalTeams = await totalTeamsQuery.CountAsync();

            return new TeamScoreDTO
            {
                Name = team.Name ?? string.Empty,
                Place = await _scoreHelper.GetTeamPlace(team, true, bracketId),
                Members = members,
                Score = await _scoreHelper.GetTeamScore(team, true),
                ChallengeTotalScore = challenges.Sum(c => c.Value ?? 0),
                TotalTeams = totalTeams
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId);
            return null;
        }
    }

    public async Task<List<SubmissionDto>> GetTeamSolves(int userId)
    {
        try
        {
            var team = await _context.Teams
                .AsNoTracking()
                .Include(t => t.Users)
                .FirstOrDefaultAsync(t => t.Users.Any(u => u.Id == userId));

            if (team == null) return [];

            return [.. (await _scoreHelper.GetTeamSolves(team, true))
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
                        Id = s?.User?.Team?.Id ?? default,
                        Name = s?.User?.Team?.Name ?? string.Empty,
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

using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Team;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace ContestantBE.Services
{
    public class TeamService : ITeamService
    {
        private readonly AppDbContext _context;
        private readonly CtfTimeHelper _ctfTimeHelper;
        private readonly ConfigHelper _configHelper;
        private readonly ScoreHelper _scoreHelper;
        private readonly AppLogger _logger;

        public TeamService(
            AppDbContext context,
            CtfTimeHelper ctfTimeHelper,
            ConfigHelper configHelper,
            ScoreHelper scoreHelper,
            AppLogger logger)
        {
            _context = context;
            _ctfTimeHelper = ctfTimeHelper;
            _configHelper = configHelper;
            _scoreHelper = scoreHelper;
            _logger = logger;
        }

        public async Task<BaseResponseDTO<TeamResponseDTO>> CreateTeam(CreateTeamRequestDTO request, User user)
        {
            try
            {
                if (!_ctfTimeHelper.CtfTime() || _ctfTimeHelper.CtfEnded())
                    return BaseResponseDTO<TeamResponseDTO>.Fail("You are not allowed to join a team at this time");

                if (user.TeamId != null)
                    return BaseResponseDTO<TeamResponseDTO>.Fail("You are already in a team");

                if (!_configHelper.GetConfig("team_creation", true))
                    return BaseResponseDTO<TeamResponseDTO>.Fail("Team creation is disabled");

                int teamLimit = _configHelper.GetConfig("num_teams", 0);
                int teamCount = _context.Teams.Count(t => (t.Banned == false) && (t.Hidden == false));
                if (teamLimit > 0 && teamCount >= teamLimit)
                    return BaseResponseDTO<TeamResponseDTO>.Fail($"Reached the maximum number of teams ({teamLimit})");

                if (string.IsNullOrWhiteSpace(request.TeamName))
                    return BaseResponseDTO<TeamResponseDTO>.Fail("Team name is required");

                if (_context.Teams.Any(t => t.Name == request.TeamName))
                    return BaseResponseDTO<TeamResponseDTO>.Fail("That team name is already taken");

                var team = new Team
                {
                    Name = request.TeamName.Trim(),
                    Password = SHA256Helper.HashPasswordPythonStyle(request.TeamPassword ?? ""),
                    CaptainId = user.Id,
                    Hidden = false,
                    BracketId = request.BracketId,
                    Website = request.Website,
                    Affiliation = request.Affiliation,
                    Country = request.Country,
                    Created = DateTime.UtcNow
                };

                _context.Teams.Add(team);

                user.TeamId = team.Id;

                await _context.SaveChangesAsync();

                return BaseResponseDTO<TeamResponseDTO>.Ok(new TeamResponseDTO
                {
                    Id = team.Id,
                    Name = team.Name,
                    Website = team.Website,
                    Affiliation = team.Affiliation,
                    Country = team.Country,
                    BracketId = team.BracketId,
                    Created = DateTime.UtcNow
                }, "Team created successfully");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, user?.Id, data: new { teamName = request.TeamName });
                return BaseResponseDTO<TeamResponseDTO>.Fail("An error occurred while creating team");
            }
        }

        public async Task<BaseResponseDTO> JoinTeam(JoinTeamRequestDTO request, User user)
        {
            try
            {
                if (!_ctfTimeHelper.CtfTime() || _ctfTimeHelper.CtfEnded())
                    return BaseResponseDTO.Fail("You are not allowed to join a team at this time");

                if (user.TeamId != null)
                    return BaseResponseDTO.Fail("You are already in a team");

                var team = await _context.Teams.FirstOrDefaultAsync(t => t.Name == request.teamName);
                if (team == null)
                    return BaseResponseDTO.Fail("Wrong team name or password");

                if (!SHA256Helper.VerifyPassword(request.teamPassword, team.Password))
                    return BaseResponseDTO.Fail("Wrong team name or password");

                int teamSizeLimit = _configHelper.GetConfig("team_size", 0);
                if (teamSizeLimit > 0)
                {
                    int teamSize = await _context.Users.CountAsync(u => u.TeamId == team.Id);
                    if (teamSize >= teamSizeLimit)
                        return BaseResponseDTO.Fail($"{team.Name} has reached the team size limit of {teamSizeLimit}");
                }

                user.TeamId = team.Id;
                _context.Users.Update(user);
                await _context.SaveChangesAsync();

                return BaseResponseDTO.Ok("Successfully joined the team!");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, user?.Id, data: new { teamName = request.teamName });
                return BaseResponseDTO.Fail("An error occurred while joining team");
            }
        }

        public async Task<TeamScoreDTO?> GetTeamScore(int userId)
        {
            try
            {
                var team = await _context.Teams
                    .AsNoTracking()
                    .Include(t => t.Users)
                    .FirstOrDefaultAsync(t => t.Users.Any(u => u.Id == userId));

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

                return new TeamScoreDTO
                {
                    Name = team.Name ?? string.Empty,
                    Place = await _scoreHelper.GetTeamPlace(team, true),
                    Members = members,
                    Score = await _scoreHelper.GetTeamScore(team, true),
                    ChallengeTotalScore = challenges.Sum(c => c.Value ?? 0)
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
}

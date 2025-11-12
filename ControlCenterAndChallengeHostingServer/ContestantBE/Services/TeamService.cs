using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Team;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.Security.Claims;

namespace ContestantBE.Services
{
    public class TeamService : ITeamService
    {
        private readonly AppDbContext _context;
        private readonly CtfTimeHelper _ctfTimeHelper;
        private readonly ConfigHelper _configHelper;
        private readonly ScoreHelper _scoreHelper;

        public TeamService(AppDbContext context, CtfTimeHelper ctfTimeHelper, ConfigHelper configHelper, ScoreHelper scoreHelper)
        {
            _context = context;
            _ctfTimeHelper = ctfTimeHelper;
            _configHelper = configHelper;
            _scoreHelper = scoreHelper;
        }

        public async Task<BaseResponseDTO<TeamResponseDTO>> CreateTeam(CreateTeamRequestDTO request, User user)
        {
            if (!_ctfTimeHelper.CtfTime() || _ctfTimeHelper.CtfEnded())
                return BaseResponseDTO<TeamResponseDTO>.Fail( "You are not allowed to join a team at this time");

            if (user.TeamId != null)
                return BaseResponseDTO<TeamResponseDTO>.Fail( "You are already in a team");

            if (!_configHelper.GetConfig("team_creation", true))
                return BaseResponseDTO<TeamResponseDTO>.Fail( "Team creation is disabled");

            int teamLimit = _configHelper.GetConfig("num_teams", 0);
            int teamCount = _context.Teams.Count(t => (t.Banned == false) && (t.Hidden == false));
            if (teamLimit > 0 && teamCount >= teamLimit)
                return BaseResponseDTO<TeamResponseDTO>.Fail( $"Reached the maximum number of teams ({teamLimit})");

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
            await _context.SaveChangesAsync();

            user.TeamId = team.Id;
            await _context.SaveChangesAsync();

            return BaseResponseDTO<TeamResponseDTO>.Ok( new TeamResponseDTO
            {
                Id = team.Id,
                Name = team.Name,
                Website = team.Website,
                Affiliation = team.Affiliation,
                Country = team.Country,
                BracketId = team.BracketId,
                Created = DateTime.UtcNow
            },"Team created successfully");
        }

        public async Task<BaseResponseDTO> JoinTeam(JoinTeamRequestDTO request, User user)
        {
            if (!_ctfTimeHelper.CtfTime() || _ctfTimeHelper.CtfEnded())
                return BaseResponseDTO.Fail( "You are not allowed to join a team at this time");

            if (user.TeamId != null)
                return BaseResponseDTO.Fail( "You are already in a team");

            var team = _context.Teams.FirstOrDefault(t => t.Name == request.teamName);
            if (team == null || !SHA256Helper.VerifyPassword(request.teamPassword, team.Password))
                return BaseResponseDTO.Fail( "Wrong team name or password");

            int teamSizeLimit = _configHelper.GetConfig("team_size", 0);
            if (teamSizeLimit > 0)
            {
                int teamSize = _context.Users.Count(u => u.TeamId == team.Id);
                if (teamSize >= teamSizeLimit)
                    return BaseResponseDTO.Fail( $"{team.Name} has reached the team size limit of {teamSizeLimit}");
            }

            user.TeamId = team.Id;
            _context.Users.Update(user);
            await _context.SaveChangesAsync();

            return BaseResponseDTO.Ok("Successfully joined the team!");
        }

        public async Task<TeamScoreDTO?> GetTeamScore(int userId)
        {
            var user = await _context.Users
                                         .Include(u => u.Team)
                                         .FirstOrDefaultAsync(u => u.Id == userId);
            var team = await _context.Teams
                .Include(t => t.Users)
                .FirstOrDefaultAsync(t => t.Users.Any(u => u.Id == user.Id));

            if (team == null) return null;

            var members = new List<TeamMemberDTO>();
            foreach (var u in team.Users)
            {
                var score = await _scoreHelper.GetUserScore(u, true);
                members.Add(new TeamMemberDTO
                {
                    Name = u.Name,
                    Email = u.Email,
                    Score = score
                });
            }

            var challenges = await _context.Challenges
                .Where(c => c.State == "visible")
                .ToListAsync();

            return new TeamScoreDTO
            {
                Name = team.Name,
                Place = await _scoreHelper.GetTeamPlace(team, true),
                Members = members,
                Score = await _scoreHelper.GetTeamScore(team, true),
                ChallengeTotalScore = challenges.Sum(c => c.Value ?? 0)
            };
        }

        public async Task<List<SubmissionDto>> GetTeamSolves(int userId)
        {
            var user = await _context.Users
                             .Include(u => u.Team)
                             .FirstOrDefaultAsync(u => u.Id == userId);
            var team = await _context.Teams
                .Include(t => t.Users)
                .FirstOrDefaultAsync(t => t.Users.Any(u => u.Id == user.Id));

            if (team == null) return new();

            return (await _scoreHelper.GetTeamSolves(team, true))
                .Select(s => new SubmissionDto
                {
                    Id = s.Id,
                    ChallengeId = s.ChallengeId,
                    Challenge = s.Challenge == null ? null : new ChallengeDto
                    {
                        Id = s.Challenge.Id,
                        Name = s.Challenge.Name,
                        Category = s.Challenge.Category,
                        Value = s.Challenge.Value ?? 0
                    },
                    User = s.User == null ? null : new UserDto
                    {
                        Id = s.User.Id,
                        Name = s.User.Name
                    },
                    Team = s.User?.Team == null ? null : new TeamDto
                    {
                        Id = s.User.Team.Id,
                        Name = s.User.Team.Name
                    },
                    Date = s.IdNavigation.Date,
                    Type = s.IdNavigation.Type,
                    Provided =  null,
                    Ip = null
                }).ToList();
        }
    }
}

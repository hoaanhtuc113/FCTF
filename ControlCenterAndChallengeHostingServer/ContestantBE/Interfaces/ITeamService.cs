using ResourceShared.DTOs;
using ResourceShared.DTOs.Team;
using ResourceShared.Models;

namespace ContestantBE.Interfaces;

public interface ITeamService
{
    Task<TeamScoreDTO?> GetTeamScore(int currentUser);
    Task<List<SubmissionDto>> GetTeamSolves(int currentUser);
}

using ResourceShared.DTOs;
using ResourceShared.DTOs.Team;
using ResourceShared.Models;

namespace ContestantBE.Interfaces;

public interface ITeamService
{
    Task<BaseResponseDTO<TeamResponseDTO>> CreateTeam(CreateTeamRequestDTO request, User currentUser);
    Task<BaseResponseDTO> JoinTeam(JoinTeamRequestDTO request, User currentUser);
    Task<TeamScoreDTO?> GetTeamScore(int currentUser);
    Task<List<SubmissionDto>> GetTeamSolves(int currentUser);
}

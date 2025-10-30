using ResourceShared.DTOs;
using ResourceShared.DTOs.Team;
using ResourceShared.Models;

namespace ContestantBE.Interfaces
{
    public interface ITeamService
    {
        Task<BaseResponseDTO<TeamResponseDTO>> CreateTeam(CreateTeamRequestDTO request, User currentUser);
        Task<BaseResponseDTO> JoinTeam(JoinTeamRequestDTO request, User currentUser);
        Task<TeamScoreDTO?> GetTeamScore(User currentUser);
        Task<List<SubmissionDto>> GetTeamSolves(User currentUser);
    }
}

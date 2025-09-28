using ResourceShared.DTOs;
using ResourceShared.DTOs.Auth;

namespace ContestantService.Interfaces
{
    public interface IAuthService
    {
        Task<BaseResponseDTO<AuthResponseDTO>> LoginContestant(LoginDTO loginDto);
    }

}

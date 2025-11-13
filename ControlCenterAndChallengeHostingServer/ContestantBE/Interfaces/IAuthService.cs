using ResourceShared.DTOs;
using ResourceShared.DTOs.Auth;

namespace ContestantBE.Interfaces
{
    public interface IAuthService
    {
        Task<BaseResponseDTO<AuthResponseDTO>> LoginContestant(LoginDTO loginDto);
        Task<BaseResponseDTO<string>> ChangePassword(int userId, ChangePasswordDTO changePasswordDto);
    }

}

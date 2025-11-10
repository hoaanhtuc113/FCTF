using ContestantBE.Interfaces;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Auth;
using ResourceShared.Models;
using ResourceShared.Utils;

namespace ContestantBE.Services
{
    public class AuthService : IAuthService
    {
        private readonly AppDbContext _context;

        public AuthService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<BaseResponseDTO<AuthResponseDTO>> LoginContestant(LoginDTO loginDto)
        {
            if (string.IsNullOrEmpty(loginDto.username) || string.IsNullOrEmpty(loginDto.password))
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Missing username or password");
            }

            var user = await _context.Users
                .Include(t => t.Team)
                .FirstOrDefaultAsync(u => u.Name == loginDto.username);

            if (user == null || !SHA256Helper.VerifyPassword(loginDto.password, user.Password) || user.Type != "user")
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Invalid username or password");
            }
            if ((user.Hidden ?? false) || (user.Banned ?? false))
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Your account is not allowed");
            }
            var dateTime = DateTime.Now.AddDays(1);
            var token = await TokenHelper.GenerateUserToken(_context, user, dateTime, "Login token");

            if (user.Team == null)
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("you don't have a team yet");
            }

            var authResponse = new AuthResponseDTO
            {
                id = user.Id,
                username = user.Name,
                email = user.Email,
                team = new TeamResponse
                {
                    id = user.Team.Id,
                    teamName = user.Team.Name
                },
                token = token.Value
            };

            return BaseResponseDTO<AuthResponseDTO>.Ok(authResponse,"Login successful");
        }
    }
}

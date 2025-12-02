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
        private TokenHelper TokenHelper;
        public AuthService(AppDbContext context, TokenHelper tokenHelper)
        {
            _context = context;
            TokenHelper = tokenHelper;
        }

        public async Task<BaseResponseDTO<AuthResponseDTO>> LoginContestant(LoginDTO loginDto)
        {
            // Trim input fields
            loginDto.username = loginDto.username?.Trim();
            loginDto.password = loginDto.password?.Trim();
            
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
            var token = await TokenHelper.GenerateUserToken(user, dateTime, "Login token");

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

        public async Task<BaseResponseDTO<string>> ChangePassword(int userId, ChangePasswordDTO changePasswordDto)
        {
            // Trim input fields
            changePasswordDto.oldPassword = changePasswordDto.oldPassword?.Trim();
            changePasswordDto.newPassword = changePasswordDto.newPassword?.Trim();
            changePasswordDto.confirmPassword = changePasswordDto.confirmPassword?.Trim();
            
            // Validate input
            if (string.IsNullOrEmpty(changePasswordDto.oldPassword) || 
                string.IsNullOrEmpty(changePasswordDto.newPassword) || 
                string.IsNullOrEmpty(changePasswordDto.confirmPassword))
            {
                return BaseResponseDTO<string>.Fail("All password fields are required");
            }

            // Check password length (max 20 characters)
            if (changePasswordDto.newPassword.Length > 20)
            {
                return BaseResponseDTO<string>.Fail("Password must not exceed 20 characters");
            }

            // Check if new password matches confirm password
            if (changePasswordDto.newPassword != changePasswordDto.confirmPassword)
            {
                return BaseResponseDTO<string>.Fail("New password and confirm password do not match");
            }

            // Get user from database
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId);
            
            if (user == null)
            {
                return BaseResponseDTO<string>.Fail("User not found");
            }

            // Verify old password
            if (!SHA256Helper.VerifyPassword(changePasswordDto.oldPassword, user.Password))
            {
                return BaseResponseDTO<string>.Fail("Old password is incorrect");
            }

            // Hash new password and update
            user.Password = SHA256Helper.HashPasswordPythonStyle(changePasswordDto.newPassword);
            
            await _context.SaveChangesAsync();

            return BaseResponseDTO<string>.Ok("Password changed successfully", "Password changed successfully");
        }
    }
}

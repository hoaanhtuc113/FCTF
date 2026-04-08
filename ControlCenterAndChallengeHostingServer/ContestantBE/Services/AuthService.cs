using ContestantBE.Interfaces;
using ContestantBE.Utils;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Auth;
using ResourceShared.Models;
using ResourceShared.Utils;
using ResourceShared.Logger;

namespace ContestantBE.Services;

public class AuthService : IAuthService
{
    private static readonly string _dummyPasswordHash = SHA256Helper.HashPasswordPythonStyle("fctf-dummy-password");
    private const string PasswordSpecialCharacters = "!@#$%^&*(),.?\":{}|<>";

    private readonly AppDbContext _context;
    private readonly TokenHelper _tokenHelper;
    private readonly UserHelper _userHelper;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly AppLogger _logger;
    private readonly RedisHelper _redisHelper;
    public AuthService(
        AppDbContext context,
        TokenHelper tokenHelper,
        UserHelper userHelper,
        IHttpContextAccessor httpContextAccessor,
        AppLogger logger,
        RedisHelper redisHelper)
    {
        _context = context;
        _tokenHelper = tokenHelper;
        _userHelper = userHelper;
        _httpContextAccessor = httpContextAccessor;
        _logger = logger;
        _redisHelper = redisHelper;
    }

    private static void RunFakeHash(string? password)
    {
        try
        {
            _ = SHA256Helper.VerifyPassword(password ?? string.Empty, _dummyPasswordHash);
        }
        catch
        {
            // Intentionally ignore to keep behavior timing-oriented only.
        }
    }

    private static bool IsValidPasswordPolicy(string password)
    {
        return password.Length >= 8
            && password.Length <= 20
            && password.Any(char.IsUpper)
            && password.Any(char.IsLower)
            && password.Any(char.IsDigit)
            && password.Any(c => PasswordSpecialCharacters.Contains(c));
    }

    public async Task<BaseResponseDTO<AuthResponseDTO>> LoginContestant(LoginDTO loginDto)
    {
        try
        {
            // Trim input fields
            loginDto.username = loginDto.username?.Trim();
            loginDto.password = loginDto.password?.Trim();

            if (string.IsNullOrEmpty(loginDto.username) || string.IsNullOrEmpty(loginDto.password))
            {
                RunFakeHash(loginDto.password);
                return BaseResponseDTO<AuthResponseDTO>.Fail("Missing username or password");
            }

            // load tracked entity so we can update password if we migrate hash format
            var user = await _context.Users
                .Include(t => t.Team)
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Name == loginDto.username);

            // Always do one password verify operation to reduce response-time variance.
            var passwordHashToVerify = string.IsNullOrWhiteSpace(user?.Password)
                ? _dummyPasswordHash
                : user.Password;
            var passwordValid = SHA256Helper.VerifyPassword(loginDto.password, passwordHashToVerify);
            
            if (user == null || user.Type != "user")
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Invalid username or password");
            }

            if(user.Verified == false)
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Your account is not verified yet");
            }

            if (!passwordValid || user.Type != "user")
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Invalid username or password");
            }
            if ((user.Hidden ?? false) || (user.Banned ?? false))
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Your account is not allowed");
            }
            if (user.Team != null && (user.Team.Banned ?? false))
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("Your team has been banned");
            }
            var dateTime = DateTime.Now.AddDays(1);
            var jwt = await _tokenHelper.GenerateUserToken(user, dateTime, "Login token");

            if (user.Team == null)
            {
                return BaseResponseDTO<AuthResponseDTO>.Fail("you don't have a team yet");
            }

            // Kiểm tra xem user đã có tracking với IP này chưa
            var userIp = _userHelper.GetIP(_httpContextAccessor.HttpContext!);
            var existingTracking = await _context.Trackings
                .FirstOrDefaultAsync(t => t.UserId == user.Id && t.Ip == userIp);

            if (existingTracking != null)
            {
                // Update date nếu đã có
                existingTracking.Date = DateTime.Now;
                _context.Trackings.Update(existingTracking);
            }
            else
            {
                // Tạo tracking mới
                var tracking = new Tracking
                {
                    Type = null,
                    Ip = userIp,
                    UserId = user.Id,
                    Date = DateTime.Now
                };
                _context.Trackings.Add(tracking);
            }

            await _context.SaveChangesAsync();

            // Invalidate cached auth info for this user so middleware reads fresh token UUID
            try
            {
                var cacheKey = $"auth:user:{user.Id}";
                _ = await _redisHelper.RemoveCacheAsync(cacheKey);
            }
            catch
            {
                // ignore cache errors
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
                token = jwt
            };

            return BaseResponseDTO<AuthResponseDTO>.Ok(authResponse, "Login successful");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, data: new { loginDto.username });
            return BaseResponseDTO<AuthResponseDTO>.Fail("An error occurred during login");
        }
    }

    public async Task<BaseResponseDTO<string>> ChangePassword(int userId, ChangePasswordDTO changePasswordDto)
    {
        try
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

            // Check if new password matches confirm password
            if (changePasswordDto.newPassword != changePasswordDto.confirmPassword)
            {
                return BaseResponseDTO<string>.Fail("New password and confirm password do not match");
            }

            if (string.Equals(changePasswordDto.oldPassword, changePasswordDto.newPassword, StringComparison.Ordinal))
            {
                return BaseResponseDTO<string>.Fail("New password must be different from current password");
            }

            if (!IsValidPasswordPolicy(changePasswordDto.newPassword))
            {
                return BaseResponseDTO<string>.Fail("New password must be 8-20 characters and include uppercase, lowercase, number, and special character");
            }

            // Get user from database
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId);

            if (user == null)
            {
                return BaseResponseDTO<string>.Fail("User not found");
            }

            // Verify old password (v2-only)
            if (!SHA256Helper.VerifyPassword(changePasswordDto.oldPassword, user.Password))
            {
                return BaseResponseDTO<string>.Fail("Old password is incorrect");
            }

            // Hash new password (v2) and update
            user.Password = SHA256Helper.HashPasswordPythonStyle(changePasswordDto.newPassword);

            await _context.SaveChangesAsync();

            return BaseResponseDTO<string>.Ok("Password changed successfully", "Password changed successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId);
            return BaseResponseDTO<string>.Fail("An error occurred while changing password");
        }
    }

    public async Task<BaseResponseDTO<string>> Logout(int userId)
    {
        try
        {
            var existingTokens = await _context.Tokens
                .Where(t => t.UserId == userId && t.Type == ResourceShared.Enums.UserType.User)
                .ToListAsync();

            if (existingTokens.Count > 0)
            {
                _context.Tokens.RemoveRange(existingTokens);
                await _context.SaveChangesAsync();
            }

            try
            {
                var cacheKey = $"auth:user:{userId}";
                _ = await _redisHelper.RemoveCacheAsync(cacheKey);
            }
            catch
            {
                // ignore cache errors
            }

            return BaseResponseDTO<string>.Ok("Logged out successfully", "Logged out successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, userId);
            return BaseResponseDTO<string>.Fail("An error occurred during logout");
        }
    }
}

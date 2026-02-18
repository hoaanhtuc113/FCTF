using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.Auth;
using ResourceShared.Logger;

namespace ContestantBE.Controllers;

public class AuthController : BaseController
{
    private readonly IAuthService _authService;
    private readonly AppLogger _userBehaviorLogger;

    public AuthController(
        IUserContext userContext,
        IAuthService authService,
        AppLogger userBehaviorLogger) : base(userContext)
    {
        _authService = authService;
        _userBehaviorLogger = userBehaviorLogger;
    }

    [HttpPost("login-contestant")]
    public async Task<IActionResult> LoginContestant([FromBody] LoginDTO loginDto)
    {
        var result = await _authService.LoginContestant(loginDto);

        if (!result.Success)
        {
            return BadRequest(new
            {
                message = result.Message,
            });
        }
        _userBehaviorLogger.Log("LOGIN", result.Data.id, result.Data.team.id, result.Data);
        await Console.Out.WriteLineAsync($"[Auth] Account {loginDto.username} login success");

        return Ok(new
        {
            generatedToken = result.Data.token,
            user = result.Data
        });

    }

    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordDTO changePasswordDto)
    {
        // Get userId from JWT token claims
        var userId = UserContext.UserId;

        var result = await _authService.ChangePassword(userId, changePasswordDto);
        await Console.Out.WriteLineAsync($"[Auth] Account {userId} change password");
        if (!result.Success)
        {
            return BadRequest(new
            {
                message = result.Message
            });
        }

        return Ok(new
        {
            message = result.Message
        });
    }
}

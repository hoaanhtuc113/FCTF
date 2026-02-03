using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.Auth;
using ResourceShared.Logger;
using System.Security.Claims;


namespace ContestantBE.Controllers;

[Route("api/[controller]")]
[ApiController]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly AppLogger _userBehaviorLogger;
    public AuthController(
        IAuthService authService,
        AppLogger userBehaviorLogger)
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

    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordDTO changePasswordDto)
    {
        // Get userId from JWT token claims
        var userIdClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new
            {
                message = "Invalid user token"
            });
        }


        var result = await _authService.ChangePassword(userId, changePasswordDto);
        await Console.Out.WriteLineAsync($"[Auth] Account {userIdClaim} change password");
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

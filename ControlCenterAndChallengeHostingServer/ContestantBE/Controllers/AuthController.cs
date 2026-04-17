using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.Auth;
using ResourceShared.Logger;
using System.Linq;

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
        _userBehaviorLogger.Log("LOGIN", result.Data.id, result.Data.team?.id, result.Data);
        await Console.Out.WriteLineAsync($"[Auth] Account {loginDto.username} login success");

        return Ok(new
        {
            generatedToken = result.Data.token,
            user = result.Data
        });

    }

    [HttpGet("registration-metadata")]
    public async Task<IActionResult> GetRegistrationMetadata()
    {
        var result = await _authService.GetRegistrationMetadata();

        if (!result.Success)
        {
            return BadRequest(new
            {
                message = result.Message,
            });
        }

        return Ok(new
        {
            data = result.Data,
        });
    }

    [HttpPost("register-contestant")]
    public async Task<IActionResult> RegisterContestant([FromBody] RegisterContestantDTO registerContestantDto)
    {
        if (!ModelState.IsValid)
        {
            var errors = ModelState
                .Where(entry => entry.Value?.Errors.Count > 0)
                .ToDictionary(
                    entry => entry.Key,
                    entry => entry.Value!.Errors
                        .Select(error => string.IsNullOrWhiteSpace(error.ErrorMessage) ? "Invalid value" : error.ErrorMessage)
                        .ToArray());

            return BadRequest(new
            {
                message = "Validation failed",
                errors,
            });
        }

        var result = await _authService.RegisterContestant(registerContestantDto);

        if (!result.Success)
        {
            return BadRequest(new
            {
                message = result.Message,
            });
        }

        return Ok(new
        {
            message = result.Message,
        });
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        var userId = UserContext.UserId;
        var teamId = UserContext.TeamId;

        var result = await _authService.Logout(userId);
        await Console.Out.WriteLineAsync($"[Auth] Account {userId} logout");
        _userBehaviorLogger.Log("LOGOUT", userId, teamId, null);

        if (!result.Success)
        {
            return BadRequest(new
            {
                message = result.Message,
            });
        }

        return Ok(new
        {
            message = result.Message,
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

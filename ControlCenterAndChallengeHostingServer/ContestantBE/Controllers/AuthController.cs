using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.DTOs.Auth;
using ResourceShared.Models;
using ResourceShared.ResponseViews;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Collections.Concurrent;
using System.Security.Claims;
using System.Text.RegularExpressions;


namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AuthController : ControllerBase
    {
        private readonly IAuthService _authService;
        public AuthController(IAuthService authService)
        {
            _authService = authService;
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
}

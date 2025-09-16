using ResourceShared.Models;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using ResourceShared.Configs;
using ResourceShared.DTOs;
using ResourceShared.ResponseViews;
using ResourceShared.Utils;
using RestSharp;
using SocialSync.Shared.Utils.ResourceShared.Utils;
using StackExchange.Redis;
using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Auth;


namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AuthController : ControllerBase
    {
        private AppDbContext _context;
        private ConfigHelper _configHelper;
        public AuthController(AppDbContext context, ConfigHelper configHelper)
        {
            _context = context;
            _configHelper = configHelper;
        }

        [HttpPost("login-contestant")]
        public async Task<IActionResult> LoginContestant([FromBody] LoginDTO LoginDTO)
        {
            if(string.IsNullOrEmpty(LoginDTO.username) || string.IsNullOrEmpty(LoginDTO.password))
            {
                return BadRequest(new 
                {
                    msg = "Missing username or password"
                });
            }
            User user = await _context.Users.Include(t=>t.Team).FirstOrDefaultAsync(u => u.Name == LoginDTO.username);
            Console.Out.WriteLine("User: "+user.Name);
            if(user!=null && SHA256Helper.VerifyPassword(LoginDTO.password, user.Password) && user.Type == "user")
            {
                DateTime dateTime = DateTime.Now + TimeSpan.FromDays(1);
                Token token = await TokenHelper.GenerateUserToken(_context,user,dateTime,"Login token");
                if(user.Team == null)
                {
                    return BadRequest(new
                    {
                        message = "you don't have a team yet",
                        generatedToken = token.Value
                    });
                }
                return Ok(new 
                {
                    generatedToken = token.Value,
                    user = new AuthResponseDTO
                    {
                        id = user.Id,
                        username = user.Name,
                        email = user.Email,
                        team = new TeamResponse
                        {
                            id = user.Team.Id,
                            teamName = user.Team.Name,
                        }
                    }
                });
            }
            else
            {
                return Unauthorized(new 
                {
                    msg = "Invalid credentials or unauthorized user type"
                });
            }   

        }

    }
}

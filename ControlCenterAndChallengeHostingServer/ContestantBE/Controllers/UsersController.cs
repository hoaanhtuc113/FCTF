using ContestantBE.Attribute;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Attribute;
using ResourceShared.DTOs.User;
using ResourceShared.Extensions;
using ResourceShared.Logger;
using ResourceShared.Models;
using System.Security.Claims;
namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class UsersController : ControllerBase
    {

        private AppDbContext _context;
        private AppLogger _userBehaviorLogger;
        public UsersController(AppDbContext context, AppLogger userBehaviorLogger) { 
            this._context = context;
            this._userBehaviorLogger = userBehaviorLogger;
        }

        [HttpGet("profile")]
        public async Task<IActionResult> GetProfile()
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier));
            var user = await _context.Users
                             .Include(u => u.Team)
                             .FirstOrDefaultAsync(u => u.Id == userId);
            _userBehaviorLogger.Log("GET_PROFILE", userId, int.Parse(User.FindFirstValue("teamId")), null);
            if (user == null || user is not User currentUser)
            {
                return NotFound(new
                {
                    success = false,
                    errors = new
                    {
                        user = "User not found"
                    }
                });
            }


            if ( (currentUser.Banned.GetValueOrDefault() || currentUser.Hidden.GetValueOrDefault()))
            {
                return NotFound();
            }

            if(currentUser.Team == null)
            {
                return NotFound(new
                {
                    success = false,
                    errors = new
                    {
                        team = "Team not found"
                    }
                });
            }

            var response = new UserDTO
            {
                Username = currentUser.Name,
                Email = currentUser.Email,
                Team = currentUser.Team.Name,
            };

            return Ok(new
            {
                success = true,
                data = response
            });

        }
    }
}

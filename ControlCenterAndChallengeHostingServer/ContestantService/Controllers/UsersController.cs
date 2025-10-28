using ContestantService.Extensions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.User;
using ResourceShared.Models;
using ContestantService.Attribute;
namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [RequireAuth]
    public class UsersController : ControllerBase
    {

        private AppDbContext _context;
        public UsersController(AppDbContext context) { 
            this._context = context;
        }

        [HttpGet("profile")]
        public IActionResult GetProfile()
        {
            var user = HttpContext.GetCurrentUser();
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

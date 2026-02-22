using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.User;
using ResourceShared.Logger;
using ResourceShared.Models;
namespace ContestantBE.Controllers;

[Authorize]
public class UsersController : BaseController
{

    private readonly AppDbContext _context;
    private readonly AppLogger _userBehaviorLogger;

    public UsersController(
        IUserContext userContext,
        AppDbContext context,
        AppLogger userBehaviorLogger) : base(userContext)
    {
        _context = context;
        _userBehaviorLogger = userBehaviorLogger;
    }

    [HttpGet("profile")]
    public async Task<IActionResult> GetProfile()
    {
        var userId = UserContext.UserId;
        var user = await _context.Users
                         .Include(u => u.Team)
                         .FirstOrDefaultAsync(u => u.Id == userId);
        _userBehaviorLogger.Log("GET_PROFILE", userId, UserContext.TeamId, null);
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

        if ((currentUser.Banned.GetValueOrDefault() || currentUser.Hidden.GetValueOrDefault()))
        {
            return NotFound();
        }

        if (currentUser.Team == null)
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

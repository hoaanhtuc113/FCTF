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
                         .Include(u => u.TeamMemberships).ThenInclude(m => m.Team)
                         .FirstOrDefaultAsync(u => u.Id == userId);
        _userBehaviorLogger.Log("GET_PROFILE", userId, null, null);
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

        // Resolve team from the active contest (X-Contest-Id header sent by fetchWithAuth),
        // falling back to the first team so the profile stays accessible in all cases.
        Team? userTeam = null;
        var contestIdHeader = Request.Headers["X-Contest-Id"].FirstOrDefault();
        if (int.TryParse(contestIdHeader, out int contestId))
        {
            userTeam = GetUserTeamForContest(currentUser, contestId);
        }
        userTeam ??= currentUser.TeamMemberships.FirstOrDefault()?.Team;

        var response = new UserDTO
        {
            Username = currentUser.Name,
            Email = currentUser.Email,
            Team = userTeam?.Name,
            TeamBracketId = userTeam?.BracketId,
        };

        return Ok(new
        {
            success = true,
            data = response
        });
    }
}

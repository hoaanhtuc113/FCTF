using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.Models;

namespace ContestantBE.Controllers;

[Route("api/[controller]")]
[ApiController]
public abstract class BaseController : ControllerBase
{
    protected readonly IUserContext UserContext;

    protected BaseController(IUserContext userContext)
    {
        UserContext = userContext;
    }

    /// <summary>
    /// Returns the team the user belongs to within the given contest.
    /// The user must be loaded with TeamMemberships.ThenInclude(m => m.Team).
    /// </summary>
    protected static Team? GetUserTeamForContest(User? user, int contestId)
    {
        return user?.TeamMemberships
            .Select(m => m.Team)
            .FirstOrDefault(t => t.ContestId == contestId);
    }
}

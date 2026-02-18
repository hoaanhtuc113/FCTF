using ContestantBE.Interfaces;
using System.Security.Claims;

namespace ContestantBE.Services;

public class UserContext : IUserContext
{
    private readonly HttpContextAccessor _httpContextAccessor;

    public UserContext(HttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public int UserId => int.Parse(_httpContextAccessor.HttpContext!.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    public int TeamId => int.Parse(_httpContextAccessor.HttpContext!.User.FindFirstValue("teamId")!);
}

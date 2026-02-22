using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Mvc;

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
}

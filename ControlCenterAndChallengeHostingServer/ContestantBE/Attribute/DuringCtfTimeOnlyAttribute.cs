using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using ResourceShared.Utils;
using System.Security.Claims;

namespace ContestantBE.Attribute;

public class DuringCtfTimeOnlyAttribute : TypeFilterAttribute
{
    public DuringCtfTimeOnlyAttribute()
        : base(typeof(DuringCtfTimeOnlyFilter))
    {
    }
}

public class DuringCtfTimeOnlyFilter : IAsyncActionFilter
{
    private readonly CtfTimeHelper _ctfTimeHelper;
    private readonly ConfigHelper _configHelper;

    public DuringCtfTimeOnlyFilter(
        CtfTimeHelper ctfTimeHelper,
        ConfigHelper configHelper)
    {
        _ctfTimeHelper = ctfTimeHelper;
        _configHelper = configHelper;
    }

    public async Task OnActionExecutionAsync(
        ActionExecutingContext context,
        ActionExecutionDelegate next)
    {
        if (_ctfTimeHelper.CtfTime())
        {
            await next();
            return;
        }

        if (_ctfTimeHelper.CtfEnded())
        {
            context.Result = new JsonResult(new { error = $"{_configHelper.CtfName()} has ended" }) { StatusCode = 403 };
            return;
        }

        if (!_ctfTimeHelper.CtfStarted())
        {
            context.Result = new JsonResult(new { error = $"{_configHelper.GetConfig("ctf_name")} has not started yet" }) { StatusCode = 403 };
            return;
        }

        if (_configHelper.IsTeamsMode()
            && context.HttpContext.User.FindFirstValue("teamId") == null)
        {
            context.Result = new JsonResult(new { error = "You must join a team to participate in this CTF" }) { StatusCode = 403 };
            return;
        }

        await next();
    }
}

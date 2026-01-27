using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using ResourceShared.Extensions;
using ResourceShared.Utils;
using System.Security.Claims;

namespace ContestantBE.Attribute;

public class DuringCtfTimeOnlyAttribute : ActionFilterAttribute
{
    public DuringCtfTimeOnlyAttribute()
    {
    }

    public override void OnActionExecuting(ActionExecutingContext context)
    {
        var ctfTimeHelper = context.HttpContext.RequestServices.GetService(typeof(CtfTimeHelper)) as CtfTimeHelper;
        var configHelper = context.HttpContext.RequestServices.GetService(typeof(ConfigHelper)) as ConfigHelper;

        if (ctfTimeHelper!.CtfTime())
            return;

        if (ctfTimeHelper.CtfEnded())
        {
            context.Result = new JsonResult(new { error = $"{configHelper!.CtfName()} has ended" }) { StatusCode = 403 };
            return;
        }

        if (!ctfTimeHelper.CtfStarted())
        {
            context.Result = new JsonResult(new { error = $"{configHelper!.GetConfig("ctf_name")} has not started yet" }) { StatusCode = 403 };
            return;
        }

        if (configHelper!.IsTeamsMode() && context.HttpContext.User.FindFirstValue("teamId") == null)
        {
            context.Result = new JsonResult(new { error = "You must join a team to participate in this CTF" }) { StatusCode = 403 };
            return;
        }
    }
}

using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using ResourceShared.Utils;

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

        // Team membership is now validated per-contest at the controller level
        // (contestId is resolved from the route, not embedded in the JWT)

        await next();
    }
}

/// <summary>
/// Allows access during CTF time OR after CTF ended when view_after_ctf is enabled.
/// Use this on read-only endpoints (view challenge, hints) — not on attempt/submit.
/// </summary>
public class DuringCtfTimeAndAfterOnlyAttribute : TypeFilterAttribute
{
    public DuringCtfTimeAndAfterOnlyAttribute()
        : base(typeof(ViewOrDuringCtfTimeOnlyFilter))
    {
    }
}

public class ViewOrDuringCtfTimeOnlyFilter : IAsyncActionFilter
{
    private readonly CtfTimeHelper _ctfTimeHelper;
    private readonly ConfigHelper _configHelper;

    public ViewOrDuringCtfTimeOnlyFilter(
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

        if (_ctfTimeHelper.CtfEnded() && _ctfTimeHelper.ViewAfterCtf())
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

        // Team membership is now validated per-contest at the controller level

        await next();
    }
}

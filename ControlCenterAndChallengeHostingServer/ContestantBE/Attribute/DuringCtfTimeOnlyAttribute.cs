using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
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
    private readonly AppDbContext _dbContext;

    public DuringCtfTimeOnlyFilter(
        CtfTimeHelper ctfTimeHelper,
        ConfigHelper configHelper,
        AppDbContext dbContext)
    {
        _ctfTimeHelper = ctfTimeHelper;
        _configHelper = configHelper;
        _dbContext = dbContext;
    }

    public async Task OnActionExecutionAsync(
        ActionExecutingContext context,
        ActionExecutionDelegate next)
    {
        // Per-contest time check when a contestId is present in the route
        if (context.RouteData.Values.TryGetValue("contestId", out var contestIdObj) &&
            int.TryParse(contestIdObj?.ToString(), out int contestId))
        {
            var contest = await _dbContext.Contests.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == contestId);

            if (contest != null)
            {
                var now = DateTime.UtcNow;

                // When paused: let request through — controller will return "paused" response
                if (contest.State == "paused")
                {
                    await next();
                    return;
                }

                bool isRunning = contest.State != "ended" &&
                    (contest.StartTime == null || now >= contest.StartTime) &&
                    (contest.EndTime == null || now <= contest.EndTime);

                if (isRunning)
                {
                    await next();
                    return;
                }

                bool ended = contest.State == "ended" ||
                    (contest.EndTime.HasValue && now > contest.EndTime.Value);

                if (ended)
                {
                    context.Result = new JsonResult(new { error = $"{contest.Name} has ended" }) { StatusCode = 403 };
                    return;
                }

                context.Result = new JsonResult(new { error = $"{contest.Name} has not started yet" }) { StatusCode = 403 };
                return;
            }
        }

        // Fallback: global time check (single-contest mode / no contestId in route)
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
    private readonly AppDbContext _dbContext;

    public ViewOrDuringCtfTimeOnlyFilter(
        CtfTimeHelper ctfTimeHelper,
        ConfigHelper configHelper,
        AppDbContext dbContext)
    {
        _ctfTimeHelper = ctfTimeHelper;
        _configHelper = configHelper;
        _dbContext = dbContext;
    }

    public async Task OnActionExecutionAsync(
        ActionExecutingContext context,
        ActionExecutionDelegate next)
    {
        // Per-contest time check when a contestId is present in the route
        if (context.RouteData.Values.TryGetValue("contestId", out var contestIdObj) &&
            int.TryParse(contestIdObj?.ToString(), out int contestId))
        {
            var contest = await _dbContext.Contests.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == contestId);

            if (contest != null)
            {
                var now = DateTime.UtcNow;

                // When paused: viewing is always allowed
                if (contest.State == "paused")
                {
                    await next();
                    return;
                }

                bool isRunning = contest.State != "ended" &&
                    (contest.StartTime == null || now >= contest.StartTime) &&
                    (contest.EndTime == null || now <= contest.EndTime);

                if (isRunning)
                {
                    await next();
                    return;
                }

                bool ended = contest.State == "ended" ||
                    (contest.EndTime.HasValue && now > contest.EndTime.Value);

                if (ended && contest.ViewAfterCtf)
                {
                    await next();
                    return;
                }

                if (ended)
                {
                    context.Result = new JsonResult(new { error = $"{contest.Name} has ended" }) { StatusCode = 403 };
                    return;
                }

                context.Result = new JsonResult(new { error = $"{contest.Name} has not started yet" }) { StatusCode = 403 };
                return;
            }
        }

        // Fallback: global time check (single-contest mode / no contestId in route)
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

        await next();
    }
}

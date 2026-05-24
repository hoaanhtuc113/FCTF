using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using ResourceShared.Utils;
namespace ContestantBE.Controllers;

[Authorize]
public class ConfigController : BaseController
{
    private readonly CtfTimeHelper _ctfTimeHelper;
    private readonly ConfigHelper _configHelper;
    private readonly AppDbContext _dbContext;

    public ConfigController(
        IUserContext userContext,
        CtfTimeHelper ctfTimeHelper,
        ConfigHelper configHelper,
        AppDbContext dbContext) : base(userContext)
    {
        _ctfTimeHelper = ctfTimeHelper;
        _configHelper = configHelper;
        _dbContext = dbContext;
    }

    private long ToLong(object val)
    {
        if (val == null) return 0;
        if (long.TryParse(val.ToString(), out var result))
        {
            return result;
        }

        return 0;
    }

    [HttpGet("get_date_config")]
    public async Task<IActionResult> GetDateTimeConfig()
    {
        var startFromConfig = ToLong(_configHelper.GetConfig("start"));
        var endFromConfig = ToLong(_configHelper.GetConfig("end"));
        if (_ctfTimeHelper.CtfEnded())
        {
            return Ok(new
            {
                isSuccess = true,
                message = "CTF has ended"
            });
        }
        if (_ctfTimeHelper.CtfTime())
        {
            return Ok(new
            {
                isSuccess = true,
                message = "CTFd has been started",
                start_date = startFromConfig,
                end_date = endFromConfig
            });
        }
        else
        {
            return Ok(new
            {
                isSuccess = true,
                message = "CTFd is coming...",
                start_date = startFromConfig,
            });
        }
    }

    // public configuration values used by the contestant portal
    [AllowAnonymous]
    [HttpGet("get_public_config")]
    public IActionResult GetPublicConfig()
    {
        var logo = _configHelper.GetConfig<string?>("ctf_logo", null);
        var icon = _configHelper.GetConfig<string?>("ctf_small_icon", null);
        var name = _configHelper.GetConfig<string>("ctf_name", "FCTF") ?? "FCTF";
        var bracketViewOther = _configHelper.GetConfig<bool>("bracket_view_other", false);
        var contestantRegistrationEnabled = _configHelper.GetConfig<bool>("contestant_registration_enabled", false);
        return Ok(new
        {
            isSuccess = true,
            ctf_logo = logo,
            ctf_small_icon = icon,
            ctf_name = name,
            bracket_view_other = bracketViewOther,
            contestant_registration_enabled = contestantRegistrationEnabled,
        });
    }

    /// <summary>
    /// Returns whether challenge content is currently accessible.
    /// True when CTF is running, or when CTF has ended and view_after_ctf is enabled.
    /// </summary>
    [HttpGet("contest_access")]
    public IActionResult GetContestAccess()
    {
        var canAccess = _ctfTimeHelper.CtfTime() ||
                        (_ctfTimeHelper.CtfEnded() && _ctfTimeHelper.ViewAfterCtf());

        string reason;
        if (_ctfTimeHelper.CtfTime())
            reason = "active";
        else if (_ctfTimeHelper.CtfEnded() && _ctfTimeHelper.ViewAfterCtf())
            reason = "ended_view_allowed";
        else if (_ctfTimeHelper.CtfEnded())
            reason = "ended";
        else
            reason = "not_started";

        return Ok(new { isSuccess = true, canAccess, reason });
    }

    [HttpGet("contest_list")]
    public async Task<IActionResult> GetContestList()
    {
        var userId = UserContext.UserId;

        var contests = await _dbContext.Contests
            .Where(c => c.State != "hidden"
                && c.Teams.Any(t => t.Members.Any(m => m.UserId == userId)))
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                slug = c.Slug,
                description = c.Description,
                state = c.State,
                start_time = c.StartTime,
                end_time = c.EndTime,
                team_count = c.Teams.Count,
                challenge_count = c.Challenges.Count(ch => ch.State == "visible"),
                category = "CTF"
            })
            .ToListAsync();

        var now = DateTime.UtcNow;

        var result = contests.Select(c =>
        {
            string status;
            if (c.state == "paused" || c.state == "ended")
            {
                status = "ended";
            }
            else if (c.start_time == null || c.end_time == null)
            {
                status = "active";
            }
            else if (now < c.start_time)
            {
                status = "upcoming";
            }
            else if (now >= c.start_time && now <= c.end_time)
            {
                status = "active";
            }
            else
            {
                status = "ended";
            }

            return new
            {
                c.id,
                c.name,
                c.slug,
                c.description,
                status,
                start_time = c.start_time?.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                end_time = c.end_time?.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                c.team_count,
                c.challenge_count,
                c.category
            };
        });

        return Ok(result);
    }
}

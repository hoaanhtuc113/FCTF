using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.Utils;
namespace ContestantBE.Controllers;

[Authorize]
public class ConfigController : BaseController
{
    private readonly CtfTimeHelper _ctfTimeHelper;
    private readonly ConfigHelper _configHelper;

    public ConfigController(
        IUserContext userContext,
        CtfTimeHelper ctfTimeHelper,
        ConfigHelper configHelper) : base(userContext)
    {
        _ctfTimeHelper = ctfTimeHelper;
        _configHelper = configHelper;
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
        var logo = _configHelper.GetConfig("ctf_logo");
        var icon = _configHelper.GetConfig("ctf_small_icon");
        var name = _configHelper.GetConfig("ctf_name");
        var bracketViewOther = _configHelper.GetConfig<bool>("bracket_view_other");
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
}

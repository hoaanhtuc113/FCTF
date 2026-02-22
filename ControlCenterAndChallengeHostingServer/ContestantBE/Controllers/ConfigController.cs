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
}

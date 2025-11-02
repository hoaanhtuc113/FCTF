using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using ResourceShared.Extensions;
using ResourceShared.Utils;

namespace ContestantBE.Attribute
{
    public class DuringCtfTimeOnlyAttribute : ActionFilterAttribute
    {


        private  CtfTimeHelper _ctfTimeHelper;
        private  ConfigHelper _configHelper;

        public DuringCtfTimeOnlyAttribute()
        {
        }

        public override void OnActionExecuting(ActionExecutingContext context)
        {
            _ctfTimeHelper = context.HttpContext.RequestServices.GetService(typeof(CtfTimeHelper)) as CtfTimeHelper;
            _configHelper = context.HttpContext.RequestServices.GetService(typeof(ConfigHelper)) as ConfigHelper;
            if (_ctfTimeHelper.CtfTime())
            {
                return;
            }
            else
            {
                if (_ctfTimeHelper.CtfEnded())
                {
                    if (_ctfTimeHelper.ViewAfterCtf() != null)
                    {
                        return;
                    }
                    else
                    {
                        context.Result = new JsonResult(new { error = $"{_configHelper.CtfName()} has ended" }) { StatusCode = 403 };
                        return;
                    }
                }
                if (!_ctfTimeHelper.CtfStarted())
                {
                    if (_configHelper.IsTeamsMode() && context.HttpContext.GetCurrentUser().TeamId == null)
                    {
                        context.Result = new JsonResult(new { error = "You must join a team to participate in this CTF" }) { StatusCode = 403 };
                        return;
                    }
                    else
                    {
                        context.Result = new JsonResult(new { error = $"{_configHelper.GetConfig("ctf_name")} has not started yet" }) { StatusCode = 403 };
                        return;
                    }
                }
            }
        }
    }
}

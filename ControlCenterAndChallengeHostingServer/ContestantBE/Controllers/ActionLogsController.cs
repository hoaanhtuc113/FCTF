using ContestantBE.Interfaces;
using ContestantBE.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.ActionLogs;

namespace ContestantBE.Controllers;

[Authorize]
public class ActionLogsController : BaseController
{
    private readonly IActionLogsServices _actionLogsServices;

    public ActionLogsController(
        IUserContext userContext,
        IActionLogsServices actionLogsServices) : base(userContext)
    {
        _actionLogsServices = actionLogsServices;
    }

    [HttpPost("save-logs")]
    public IActionResult SaveActionLogs([FromBody] ActionLogsReq req)
    {
        return StatusCode(403, new { success = false, message = "Activity logs are recorded by server actions." });
    }

    [HttpGet("get-logs-team")]
    public async Task<IActionResult> GetActionLogsTeam([FromQuery] int page = 1,
        [FromQuery(Name = "per_page")] int? perPage = null, [FromQuery] int? pageSize = null,
        [FromQuery] string? q = null, [FromQuery] int? actionType = null, [FromQuery] string? topic = null)
    {
        var size = perPage ?? pageSize ?? 50;
        if (page < 1 || size < 1 || size > 100 || (long)(page - 1) * size > int.MaxValue
            || (perPage.HasValue && pageSize.HasValue && perPage != pageSize)
            || q?.Length > 200 || topic?.Length > 255 || actionType is < 1 or > 7)
            return BadRequest(new { success = false, message = "Invalid pagination or filter" });
        var teamId = UserContext.TeamId;
        var result = await _actionLogsServices.GetActionLogsTeamPage(teamId, page, size, q, actionType, topic);
        var pages = (result.Total + (long)size - 1) / size;
        return Ok(new
        {
            success = true,
            data = result.Logs,
            topics = result.Topics,
            meta = new { pagination = new { page, per_page = size, total = result.Total, pages,
                next = page < pages ? (int?)page + 1 : null, prev = page > 1 ? (int?)page - 1 : null } }
        });
    }
}

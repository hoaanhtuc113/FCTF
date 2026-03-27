using ContestantBE.Attribute;
using ContestantBE.Interfaces;
using ContestantBE.Utils;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.Logger;

namespace ContestantBE.Controllers;

[Authorize]
public class FilesController : BaseController
{
    private readonly IFileService _fileService;
    private readonly AppLogger _userBehaviorLogger;

    public FilesController(
        IUserContext userContext,
        IFileService fileService,
        AppLogger userBehaviorLogger) : base(userContext)
    {
        _fileService = fileService;
        _userBehaviorLogger = userBehaviorLogger;
    }

    [HttpGet("")]
    [DuringCtfTimeAndAfterOnly]
    public async Task<IActionResult> GetFile([FromQuery] string path, [FromQuery] string token)
    {
        var userId = UserContext.UserId;
        var teamId = UserContext.TeamId;
        _userBehaviorLogger.Log("GET_FILE", userId, teamId, new { file_path = path });

        if (string.IsNullOrWhiteSpace(path))
        {
            return BadRequest(new { success = false, message = "Missing 'path' parameter" });
        }
        var result = await _fileService.GetFileAsync(path, token, userId);

        if (!result.Success)
        {
            if (result.Message?.Contains("not found") == true)
            {
                return NotFound(new { success = false, message = result.Message });
            }
            return BadRequest(new { success = false, message = result.Message });
        }

        if (result.FileStream == null || string.IsNullOrEmpty(result.FileName))
        {
            return StatusCode(500, new { success = false, message = "Error retrieving file" });
        }

        return File(result.FileStream, result.ContentType ?? "application/octet-stream", result.FileName);
    }
}

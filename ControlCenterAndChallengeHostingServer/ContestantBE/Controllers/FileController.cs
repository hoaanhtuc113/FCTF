using ContestantBE.Attribute;
using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.Logger;
using System.Security.Claims;

namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class FilesController : ControllerBase
    {
        private readonly IFileService _fileService;
        private readonly AppLogger _userBehaviorLogger;

        public FilesController(
            IFileService fileService,
            AppLogger userBehaviorLogger)
        {
            _fileService = fileService;
            _userBehaviorLogger = userBehaviorLogger;
        }

        [HttpGet("")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetFile([FromQuery] string path, [FromQuery] string token)
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var teamId = int.Parse(User.FindFirstValue("teamId")!);
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
}

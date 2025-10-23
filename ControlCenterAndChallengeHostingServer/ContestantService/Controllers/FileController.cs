using ContestantService.Attribute;
using ContestantService.Extensions;
using ContestantService.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ResourceShared.DTOs.File;
using ResourceShared.Models;
using ResourceShared.Utils;
using System.IO;

namespace ContestantService.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class FilesController : ControllerBase
    {
        private readonly IFileService _fileService;

        public FilesController(IFileService fileService)
        {
            _fileService = fileService;
        }

        [HttpGet("")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        [DuringCtfTimeOnly]
        public async Task<IActionResult> GetFile([FromQuery] string path, [FromQuery] string token)
        {
            var user = HttpContext.GetCurrentUser();
            if (user == null || user is not User currentUser)
            {
                return NotFound(new
                {
                    success = false,
                    errors = new
                    {
                        user = "User not found"
                    }
                });
            }
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest(new { success = false, message = "Missing 'path' parameter" });
            }
            await Console.Out.WriteLineAsync($"GetFileAsync: {path}");
            var result = await _fileService.GetFileAsync(path,token,user.Id);

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

using ContestantBE.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;

namespace ContestantBE.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ScoreboardController : ControllerBase
    {
        private readonly IScoreboardService _scoreboardService;

        public ScoreboardController(IScoreboardService scoreboardService)
        {
            _scoreboardService = scoreboardService;
        }

        [HttpGet("top/{count:int}")]
        [OutputCache(Duration = 60)]
        public async Task<IActionResult> GetTopTeams(int count, [FromQuery] int? bracket_id)
        {
            var result = await _scoreboardService.GetTopStandings(count, bracket_id);
            return Ok(new { success = true, data = result });
        }
    }
}

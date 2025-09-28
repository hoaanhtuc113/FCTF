using ContestantService.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.EntityFrameworkCore;
using ResourceShared.DTOs.Submit;
using ResourceShared.Models;
using ResourceShared.Utils;
using StackExchange.Redis;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace ContestantService.Controllers
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

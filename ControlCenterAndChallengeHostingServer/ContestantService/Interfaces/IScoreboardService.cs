using ResourceShared.DTOs.Score;

namespace ContestantService.Interfaces
{
    public interface IScoreboardService
    {
        Task<List<ScoreboardEntryDTO>> GetTopStandings(int count, int? bracketId);
    }
}

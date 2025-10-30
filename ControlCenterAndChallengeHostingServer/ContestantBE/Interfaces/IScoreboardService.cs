using ResourceShared.DTOs.Score;

namespace ContestantBE.Interfaces
{
    public interface IScoreboardService
    {
        Task<List<ScoreboardEntryDTO>> GetTopStandings(int count, int? bracketId);
    }
}

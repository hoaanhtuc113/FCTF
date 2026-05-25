using ResourceShared.DTOs.Hint;

namespace ContestantBE.Interfaces;

public interface IHintService
{
    Task<HintResponseDTO?> GetHintById(int id, int? user, bool preview, int contestId);
    Task<HintListDTO?> GetHintsByChallengeId(int challengeId, int user, int contestId);
    Task<UnlockResponseDTO?> UnlockHint(UnlockRequestDto req, int user, int contestId);
}

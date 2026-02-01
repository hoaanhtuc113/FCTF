using ResourceShared.DTOs.Hint;

namespace ContestantBE.Interfaces;

public interface IHintService
{
    Task<HintResponseDTO?> GetHintById(int id, int? user, bool preview);
    Task<HintListDTO?> GetHintsByChallengeId(int challengeId, int user);
    Task<UnlockResponseDTO?> UnlockHint(UnlockRequestDto req, int user);
}

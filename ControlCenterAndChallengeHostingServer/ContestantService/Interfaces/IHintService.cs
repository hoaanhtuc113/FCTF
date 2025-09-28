using ResourceShared.DTOs.Hint;
using ResourceShared.Models;

namespace ContestantService.Interfaces
{
    public interface IHintService
    {
        Task<HintResponseDTO?> GetHintById(int id, User? user, bool preview);
        Task<HintListDTO> GetHintsByChallengeId(int challengeId, User user);
        Task<UnlockResponseDTO?> UnlockHint(UnlockRequestDto req, User user);
    }
}

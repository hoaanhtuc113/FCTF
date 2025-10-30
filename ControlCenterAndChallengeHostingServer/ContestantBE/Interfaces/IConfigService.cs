using ResourceShared.DTOs.Config;

namespace ContestantBE.Interfaces
{
    public interface IConfigService
    {
        Task<DateConfigResponseDTO> GetDateTimeConfig();
    }
}

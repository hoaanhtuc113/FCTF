using ResourceShared.DTOs.Config;

namespace ContestantService.Interfaces
{
    public interface IConfigService
    {
        Task<DateConfigResponseDTO> GetDateTimeConfig();
    }
}

using ContestantBE.Interfaces;
using ResourceShared.DTOs.Config;
using ResourceShared.Utils;
using ResourceShared.Logger;

namespace ContestantBE.Services;

public class ConfigService : IConfigService
{
    private readonly ConfigHelper _configHelper;
    private readonly CtfTimeHelper _ctfTimeHelper;
    private readonly AppLogger _logger;

    public ConfigService(ConfigHelper configHelper, CtfTimeHelper ctfTimeHelper, AppLogger logger)
    {
        _configHelper = configHelper;
        _ctfTimeHelper = ctfTimeHelper;
        _logger = logger;
    }

    private long ToLong(object val)
    {
        if (val == null) return 0;
        if (long.TryParse(val.ToString(), out var result))
            return result;
        return 0;
    }

    public async Task<DateConfigResponseDTO> GetDateTimeConfig()
    {
        try
        {
            var startFromConfig = ToLong(_configHelper.GetConfig("start"));
            var endFromConfig = ToLong(_configHelper.GetConfig("end"));

            if (_ctfTimeHelper.CtfEnded())
            {
                return new DateConfigResponseDTO
                {
                    IsSuccess = true,
                    Message = "CTF has ended"
                };
            }

            if (_ctfTimeHelper.CtfTime())
            {
                return new DateConfigResponseDTO
                {
                    IsSuccess = true,
                    Message = "CTFd has been started",
                    StartDate = startFromConfig,
                    EndDate = endFromConfig
                };
            }

            return new DateConfigResponseDTO
            {
                IsSuccess = true,
                Message = "CTFd is coming...",
                StartDate = startFromConfig
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex);
            return new DateConfigResponseDTO
            {
                IsSuccess = false,
                Message = "An error occurred while fetching the configuration."
            };
        }
    }

}

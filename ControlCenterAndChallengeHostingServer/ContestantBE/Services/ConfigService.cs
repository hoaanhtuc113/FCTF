using ContestantBE.Interfaces;
using ResourceShared.DTOs.Config;
using ResourceShared.Utils;

namespace ContestantBE.Services
{
    public class ConfigService : IConfigService
    {
        private readonly ConfigHelper _configHelper;
        private readonly CtfTimeHelper _ctfTimeHelper;

        public ConfigService(ConfigHelper configHelper, CtfTimeHelper ctfTimeHelper)
        {
            _configHelper = configHelper;
            _ctfTimeHelper = ctfTimeHelper;
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

    }
}

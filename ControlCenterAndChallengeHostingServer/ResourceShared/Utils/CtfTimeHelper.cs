using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.Utils
{

    public class CtfTimeHelper
    {
        private static readonly DateTime UnixEpoch = new(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        private readonly ConfigHelper _config;

        public CtfTimeHelper(ConfigHelper config)
        {
            _config = config;
        }

        public bool CtfTime()
        {
            long start = ToLong(_config.GetConfig("start"));
            long end = ToLong(_config.GetConfig("end"));
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

            if (start > 0 && end > 0)
            {
                if (start < now && now < end)
                    return true;
            }

            if (start > 0 && end == 0)
                return now > start;

            if (start == 0 && end > 0)
                return now < end;

            if (start == 0 && end == 0)
                return true;

            return false;
        }

        public bool CtfPaused()
        {
            return ToBool(_config.GetConfig("paused"));
        }

        public bool CtfStarted()
        {
            long start = ToLong(_config.GetConfig("start"));
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            return now > start;
        }

        public bool CtfEnded()
        {
            long end = ToLong(_config.GetConfig("end"));
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            return end > 0 && now > end;
        }

        public bool ViewAfterCtf()
        {
            return _config.GetConfig<bool>("view_after_ctf");
        }


        public long UnixTime(DateTime dt)
        {
            if (dt == default) throw new ArgumentException("Invalid datetime");
            return (long)(dt.ToUniversalTime() - UnixEpoch).TotalSeconds;
        }

        public long UnixTimeMillis(DateTime dt)
        {
            return UnixTime(dt) * 1000;
        }

        public DateTime UnixTimeToUtc(long timestamp)
        {
            return UnixEpoch.AddSeconds(timestamp);
        }

        public string IsoFormat(DateTime dt)
        {
            if (dt == default) throw new ArgumentException("Invalid datetime");
            return dt.ToUniversalTime().ToString("o") + "Z";
        }

        // ===== Helper Convert =====

        private long ToLong(object val)
        {
            if (val == null) return 0;
            if (long.TryParse(val.ToString(), out var result))
                return result;
            return 0;
        }

        private bool ToBool(object val)
        {
            if (val == null) return false;
            if (bool.TryParse(val.ToString(), out var result))
                return result;
            return false;
        }
    }

}

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.Utils
{
    public class ConfigHelper
    {
        private readonly AppDbContext _db;
        private readonly IMemoryCache _cache;
        private const string CacheKeyPrefix = "Config_";
        private static readonly TimeSpan CacheExpiration = TimeSpan.FromMinutes(5);

        public ConfigHelper(AppDbContext db, IMemoryCache cache)
        {
            _db = db;
            _cache = cache;
        }
        public T? GetConfig<T>(object key, T? defaultValue = default)
        {
            if (key is Enum enumKey)
                key = enumKey.ToString();

            if (key == null)
                return defaultValue;

            var value = GetConfig(key.ToString()!);

            if (value is KeyNotFoundException || value == null)
                return defaultValue;

            try
            {
                return (T)Convert.ChangeType(value, typeof(T));
            }
            catch
            {
                return defaultValue;
            }
        }

        public object GetConfig(string key)
        {
            if (string.IsNullOrEmpty(key))
                return new KeyNotFoundException();

            // Try to get from cache first
            var cacheKey = CacheKeyPrefix + key;
            if (_cache.TryGetValue(cacheKey, out object? cachedValue))
            {
                return cachedValue ?? new KeyNotFoundException();
            }

            // If not in cache, query database
            var config = _db.Configs.AsNoTracking().FirstOrDefault(c => c.Key == key);
            object result;
            
            if (config != null && !string.IsNullOrEmpty(config.Value))
            {
                string value = config.Value;

                if (int.TryParse(value, out int intVal))
                    result = intVal;
                else if (bool.TryParse(value, out bool boolVal))
                    result = boolVal;
                else
                    result = value;
            }
            else
            {
                result = new KeyNotFoundException();
            }

            // Cache the result
            _cache.Set(cacheKey, result, CacheExpiration);
            
            return result;
        }
        private long ToLong(object val,int defaultValue=3)
        {
            if (val == null) return defaultValue;
            if (long.TryParse(val.ToString(), out var result))
            {
                return result;
            }

            return defaultValue;
        }
        public long LimitChallenges()
        {
            return ToLong(GetConfig("limit_challenges"));
        }
        public object CtfName()
        {
            return GetConfig("ctf_name", "CTF") ?? "CTF";
        }

        public string? UserMode()
        {
            return GetConfig<string>("user_mode");
        }

        public bool IsUserMode()
        {
            return UserMode()?.ToString() == Enums.Mode.User;
        }

        public bool IsTeamsMode()
        {
            return UserMode()?.ToString() == Enums.Mode.Team;
        }
    }

}

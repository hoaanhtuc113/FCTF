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
        private readonly DbContextOptions<AppDbContext> _dbOptions;

        public ConfigHelper(DbContextOptions<AppDbContext> dbOptions)
        {
            _dbOptions = dbOptions;
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

        public async Task<object> GetConfig(string key)
        {
            using (var context = new AppDbContext(_dbOptions))
            {
                // If not in cache, query database
                var config = await context.Configs.AsNoTracking().FirstOrDefaultAsync(c => c.Key == key);
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

                return result;
            }
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

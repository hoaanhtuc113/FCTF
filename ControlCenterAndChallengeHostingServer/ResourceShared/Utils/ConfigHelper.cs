using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using System.Collections.Generic;
using System.Linq;

namespace ResourceShared.Utils
{
    public class ConfigHelper
    {
        private readonly AppDbContext _context;

        public ConfigHelper(AppDbContext context)
        {
            _context = context;
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
            // If not in cache, query database
            var config = _context.Configs
                .AsNoTracking()
                .FirstOrDefault(c => c.Key == key);

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

        public HashSet<string> HiddenCategories()
        {
            var rawValue = GetConfig("hidden_categories");
            if (rawValue == null || rawValue is KeyNotFoundException)
            {
                return [];
            }

            var categories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var category in rawValue.ToString()!.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
            {
                var normalized = category.Trim();
                if (!string.IsNullOrWhiteSpace(normalized))
                {
                    categories.Add(normalized);
                }
            }

            return categories;
        }

        public bool IsHiddenCategory(string? category)
        {
            if (string.IsNullOrWhiteSpace(category))
            {
                return false;
            }

            return HiddenCategories().Contains(category.Trim());
        }

        private long ToLong(object val, int defaultValue = 3)
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

        /// <summary>
        /// Read config: DB config table first, fallback to ENV var, then default.
        /// </summary>
        public string GetDbOrEnvConfig(string dbKey, string envKey, string defaultValue = "")
        {
            var dbVal = GetConfig<string>(dbKey);
            if (!string.IsNullOrWhiteSpace(dbVal)) return dbVal;
            var envVal = Environment.GetEnvironmentVariable(envKey);
            return string.IsNullOrWhiteSpace(envVal) ? defaultValue : envVal;
        }
    }

}

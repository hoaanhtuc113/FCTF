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

        public ConfigHelper(AppDbContext db)
        {
            _db = db;
        }
        public T GetConfig<T>(object key, T defaultValue = default)
        {
            if (key is Enum enumKey)
                key = enumKey.ToString();

            var value = GetConfig(key.ToString());

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

            var config = _db.Configs.FirstOrDefault(c => c.Key == key);
            if (config != null && !string.IsNullOrEmpty(config.Value))
            {
                string value = config.Value;

                if (int.TryParse(value, out int intVal))
                    return intVal;

                if (bool.TryParse(value, out bool boolVal))
                    return boolVal;

                return value;
            }
            return new KeyNotFoundException();
        }

        public object CtfName()
        {
            return GetConfig("ctf_name", "CTF");
        }

        public string UserMode()
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

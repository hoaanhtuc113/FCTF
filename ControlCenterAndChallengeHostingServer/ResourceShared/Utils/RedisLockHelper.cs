using StackExchange.Redis;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.Utils
{
    public class RedisLockHelper
    {
        private readonly IDatabase _redis;

        public RedisLockHelper(IConnectionMultiplexer multiplexer)
        {
            _redis = multiplexer.GetDatabase();
        }

        /// <summary>
        /// Acquire a distributed lock (non-blocking)
        /// </summary>
        public async Task<bool> AcquireLock(string key, string token, TimeSpan expiry)
        {
            return await _redis.StringSetAsync(
                key,
                token,
                expiry,
                When.NotExists,        // SET NX
                CommandFlags.DemandMaster
            );
        }

        /// <summary>
        /// Release lock safely using Lua script (prevents deleting other's lock)
        /// </summary>
        public async Task ReleaseLock(string key, string token)
        {
            const string luaScript = @"
                if redis.call('GET', KEYS[1]) == ARGV[1] then
                    return redis.call('DEL', KEYS[1])
                else
                    return 0
                end";

            await _redis.ScriptEvaluateAsync(
                luaScript,
                new RedisKey[] { key },
                new RedisValue[] { token }
            );
        }

        /// <summary>
        /// Blocking lock with retry (recommended for Worker only)
        /// </summary>
        public async Task<bool> AcquireWithRetry(string key, string token, TimeSpan expiry, int retry = 5, int delayMs = 20)
        {
            for (int i = 0; i < retry; i++)
            {
                bool acquired = await AcquireLock(key, token, expiry);
                if (acquired) return true;

                await Task.Delay(delayMs);
            }
            return false;
        }
    }
}

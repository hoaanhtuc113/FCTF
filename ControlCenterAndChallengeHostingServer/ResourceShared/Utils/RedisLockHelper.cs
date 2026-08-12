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
        /// Blocking lock with retry (recommended for Worker only).
        /// The lock is not a queue, so waiters that retry on the same fixed schedule stay
        /// in step and Redis keeps picking among them arbitrarily - one of them can lose
        /// every round and exhaust its budget while the others take turns. Jittering the
        /// delay spreads their attempts out instead of letting them arrive together.
        /// </summary>
        public async Task<bool> AcquireWithRetry(string key, string token, TimeSpan expiry, int retry = 5, int delayMs = 20)
        {
            for (int i = 0; i < retry; i++)
            {
                bool acquired = await AcquireLock(key, token, expiry);
                if (acquired) return true;

                // Nothing left to wait for after the final attempt.
                if (i == retry - 1) break;

                // Jitter around delayMs rather than growing backoff: the expected wait
                // per round, and so each caller's overall budget, stays what it was.
                await Task.Delay(Random.Shared.Next(delayMs / 2, (delayMs * 3 / 2) + 1));
            }
            return false;
        }
    }
}

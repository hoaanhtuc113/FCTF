using Newtonsoft.Json;
using ResourceShared;
using ResourceShared.Utils;
using StackExchange.Redis;
using static ResourceShared.Enums;

namespace ResourceShared.Utils;

public class RedisHelper
{
    private readonly IDatabase _cache;
    private const int RedisScanPageSize = 1000;
    private const int RedisValueBatchSize = 500;

    // Constructor nhận ConnectionMultiplexer thông qua Dependency Injection
    public RedisHelper(IConnectionMultiplexer redisConnection)
    {
        _cache = redisConnection.GetDatabase();
    }

    // Phương thức để set object (phức tạp hơn string) vào cache
    public async Task<bool> SetCacheAsync<T>(string key, T value, TimeSpan? expiredTime = null)
    {
        try
        {
            // Serialize object to string
            string stringValue = JsonConvert.SerializeObject(value);
            bool isSet;
            if (expiredTime.HasValue)
            {
                isSet = await _cache.StringSetAsync(key, stringValue, expiredTime.Value);
            }
            else
            {
                // không expire
                isSet = await _cache.StringSetAsync(key, stringValue);
            }
            return isSet;
        }
        catch (Exception)
        {
            // Nếu có lỗi, trả về false
            return false;
        }
    }

    // Phương thức để lấy object từ cache
    public async Task<T?> GetFromCacheAsync<T>(string key)
    {
        try
        {
            // Lấy dữ liệu từ cache
            string? value = await _cache.StringGetAsync(key);

            if (string.IsNullOrEmpty(value))
            {
                return default; // Nếu không có giá trị hoặc key không tồn tại
            }

            // Deserialize giá trị thành object
            return JsonConvert.DeserializeObject<T>(value);
        }
        catch (Exception)
        {
            // Nếu có lỗi, trả về giá trị mặc định
            return default;
        }
    }
    public async Task<Dictionary<string, T?>> GetManyAsync<T>(IReadOnlyCollection<string> keys)
    {
        var result = new Dictionary<string, T?>(keys.Count);

        if (keys.Count == 0)
            return result;

        var redisKeys = keys.Select(k => (RedisKey)k).ToArray();
        var values = await _cache.StringGetAsync(redisKeys);

        for (int i = 0; i < redisKeys.Length; i++)
        {
            var value = values[i];
            if (value.IsNullOrEmpty)
            {
                result[(string)redisKeys[i]!] = default;
                continue;
            }

            try
            {
                result[(string)redisKeys[i]!] =
                    JsonConvert.DeserializeObject<T>(value!);
            }
            catch
            {
                result[(string)redisKeys[i]!] = default;
            }
        }
        return result;
    }

    // Phương thức để xóa giá trị từ cache dựa vào key
    public async Task<bool> RemoveCacheAsync(string key)
    {
        try
        {
            // Xóa key từ cache
            bool isRemoved = await _cache.KeyDeleteAsync(key);
            return isRemoved;
        }
        catch (Exception)
        {
            // Nếu có lỗi, trả về false
            return false;
        }
    }
    public List<string> GetKeysByPattern(string pattern)
    {
        try
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            var endpoints = _cache.Multiplexer.GetEndPoints();

            foreach (var endpoint in endpoints)
            {
                var server = _cache.Multiplexer.GetServer(endpoint);
                if (server.IsConnected)
                {
                    // Use SCAN via server.Keys with page size to avoid blocking Redis
                    foreach (var key in server.Keys(pattern: pattern, pageSize: RedisScanPageSize))
                    {
                        keys.Add(key.ToString());
                    }
                }
            }

            return keys.ToList();
        }
        catch (Exception)
        {
            // Nếu có lỗi, trả về danh sách rỗng
            return new List<string>();
        }
    }

    public async Task<List<T>> GetCacheByPatternAsync<T>(string pattern)
    {
        var result = new List<T>();

        try
        {
            var endpoints = _cache.Multiplexer.GetEndPoints();
            foreach (var endpoint in endpoints)
            {
                var server = _cache.Multiplexer.GetServer(endpoint);
                if (!server.IsConnected) continue;

                var batch = new List<RedisKey>(RedisValueBatchSize);

                async Task FlushBatchAsync()
                {
                    if (batch.Count == 0) return;
                    var values = await _cache.StringGetAsync(batch.ToArray());

                    foreach (var value in values)
                    {
                        if (!value.IsNullOrEmpty)
                        {
                            var item = JsonConvert.DeserializeObject<T>(value);
                            if (item != null)
                                result.Add(item);
                        }
                    }

                    batch.Clear();
                }

                foreach (var key in server.Keys(pattern: pattern, pageSize: RedisScanPageSize))
                {
                    batch.Add(key);
                    if (batch.Count >= RedisValueBatchSize)
                    {
                        await FlushBatchAsync();
                    }
                }

                await FlushBatchAsync();
            }
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"[Redis] Pattern read failed: {ex.Message}");
        }

        return result;
    }

    public async Task<bool> RemoveCacheByPattern(string pattern)
    {
        try
        {
            var keys = GetKeysByPattern(pattern);

            if (!keys.Any())
            {
                return true;
            }

            foreach (var batch in keys.Chunk(100))
            {
                var tasks = batch.Select(k => _cache.KeyDeleteAsync(k));
                await Task.WhenAll(tasks);
            }

            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }


    public async Task<bool> KeyExistsAsync(string key)
    {
        try
        {
            return await _cache.KeyExistsAsync(key);
        }
        catch (Exception)
        {
            return false;
        }

    }

    /// <summary>
    /// 1. HÀM START (Controller gọi):
    /// Kiểm tra limit, giữ chỗ (Reservation) trong ZSET với thời gian tạm (Provisioning TTL).
    /// </summary>
    /// <param name="teamId">ID Team</param>
    /// <param name="deploymentKey">Key chứa data JSON</param>
    /// <param name="challengeId">Unique ID của bài thi (dùng làm member trong ZSET)</param>
    /// <param name="maxLimit">Giới hạn số bài thi tối đa</param>
    /// <param name="deploymentValue">Data JSON</param>
    /// <param name="provisioningTtl">Thời gian giữ chỗ tạm thời (Mặc định 300s = 5 phút)</param>
    /// <returns>
    /// 0: Success (Thành công)
    /// 1: Limit Exceeded (Hết lượt)
    /// 2: Already Exists (Đang chạy rồi)
    /// </returns>
    public async Task<DeploymentCheckResult> AtomicCheckAndCreateDeploymentZSet(
        string teamId,
        string deploymentKey,
        string challengeId,
        long maxLimit,
        string deploymentValue,
        int provisioningTtl = 300)
    {
        var zsetKey = ChallengeHelper.GetZSetKKey(int.Parse(teamId));

        // Score tạm thời = Hiện tại + 5 phút
        // Nếu sau 5 phút Worker không gia hạn, Redis tự coi là hết hạn và cho phép ghi đè.
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var tempScore = now + provisioningTtl;

        var script = @"
                    local zsetKey = KEYS[1]
                    local deploymentKey = KEYS[2]
                    
                    local uniqueId = ARGV[1]
                    local maxLimit = tonumber(ARGV[2])
                    local deploymentValue = ARGV[3]
                    local tempScore = tonumber(ARGV[4])
                    local now = tonumber(ARGV[5])
                    local provisioningTtl = tonumber(ARGV[6])

                    -- A. SELF-HEALING: Tự động dọn dẹp các deployment đã hết hạn/lỗi
                    -- (Bao gồm cả những cái 'đặt gạch' quá 5 phút mà K8s không phản hồi)
                    redis.call('ZREMRANGEBYSCORE', zsetKey, '-inf', now)

                    -- B. Check Idempotency: Nếu ID này đang chạy và còn hạn -> Báo lỗi
                    if redis.call('ZSCORE', zsetKey, uniqueId) then
                        return 2 -- Already Exists
                    end

                    -- C. Check Limit: Đếm số lượng thực tế đang sống
                    -- maxLimit <= 0 nghĩa là không giới hạn (unlimited)
                    local currentCount = redis.call('ZCARD', zsetKey)
                    if maxLimit > 0 and currentCount >= maxLimit then
                        return 1 -- Limit Exceeded
                    end

                    -- D. Create Reservation (Đặt gạch)
                    -- Lưu data JSON với TTL tạm thời
                    redis.call('SETEX', deploymentKey, provisioningTtl, deploymentValue)
                    
                    -- Thêm vào ZSET với Score tạm thời
                    redis.call('ZADD', zsetKey, tempScore, uniqueId)
                    
                    -- Gia hạn sự sống cho cái danh sách ZSET
                    redis.call('EXPIRE', zsetKey, 1800)

                    return 0 -- Success
                ";

        try
        {
            var result = await _cache.ScriptEvaluateAsync(
                script,
                keys: new RedisKey[] { zsetKey, deploymentKey },
                values: new RedisValue[] { challengeId, maxLimit, deploymentValue, tempScore, now, provisioningTtl }
            );
            return (DeploymentCheckResult)(int)result;
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"[Redis] Start Failed: {ex.Message}");
            throw;
        }
    }

    /// <summary>
    /// Giữ một chỗ trong hạn ngạch hàng đợi deploy của MỘT cuộc thi.
    ///
    /// deployment_queue là hàng đợi dùng chung cho mọi cuộc thi và có x-max-length,
    /// nên khi nó đầy thì broker từ chối publish của tất cả - một cuộc thi đông
    /// người chơi đẩy các cuộc thi còn lại vào 429 dù chúng chưa deploy gì. Hạn
    /// ngạch này chặn ở khâu nạp hàng: mỗi cuộc thi chỉ chiếm được phần của mình,
    /// nên luôn còn chỗ trống cho những cuộc thi khác publish.
    ///
    /// Chỗ giữ tự rụng theo score chứ không cần trả lại: thời gian sống của nó
    /// đúng bằng TTL của message, mà một message nằm quá TTL thì broker cũng đã
    /// vứt đi rồi - giữ chỗ cho nó không còn ý nghĩa gì.
    /// </summary>
    /// <param name="contestId">ID cuộc thi, tra từ DB chứ không lấy từ request</param>
    /// <param name="member">ID duy nhất của lượt deploy (dùng deploymentKey)</param>
    /// <param name="maxInflight">Số message tối đa một cuộc thi được chiếm. &lt;= 0 là không giới hạn</param>
    /// <param name="ttlSeconds">Thời gian giữ chỗ, đặt bằng TTL của message</param>
    /// <returns>true nếu giữ được chỗ (hoặc đang giữ sẵn), false nếu cuộc thi đã hết hạn ngạch</returns>
    public async Task<bool> AtomicTryReserveContestSlot(
        string contestId,
        string member,
        long maxInflight,
        int ttlSeconds)
    {
        if (maxInflight <= 0) return true;

        var zsetKey = $"contest_queue_slots_{contestId}";
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var expireAt = now + ttlSeconds;

        var script = @"
                    local zsetKey = KEYS[1]

                    local member = ARGV[1]
                    local maxInflight = tonumber(ARGV[2])
                    local now = tonumber(ARGV[3])
                    local expireAt = tonumber(ARGV[4])

                    -- Dọn các chỗ đã quá hạn trước khi đếm
                    redis.call('ZREMRANGEBYSCORE', zsetKey, '-inf', now)

                    -- Đang giữ sẵn thì coi như thành công, không tính thêm một chỗ nữa
                    if redis.call('ZSCORE', zsetKey, member) then
                        return 1
                    end

                    if redis.call('ZCARD', zsetKey) >= maxInflight then
                        return 0
                    end

                    redis.call('ZADD', zsetKey, expireAt, member)
                    redis.call('EXPIRE', zsetKey, expireAt - now)
                    return 1
                ";

        try
        {
            var result = await _cache.ScriptEvaluateAsync(
                script,
                keys: new RedisKey[] { zsetKey },
                values: new RedisValue[] { member, maxInflight, now, expireAt }
            );
            return (int)result == 1;
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"[Redis] Contest slot reservation failed: {ex.Message}");
            throw;
        }
    }

    /// <summary>
    /// Đếm số lần một team xin start trong cửa sổ trượt gần nhất, cùng khuôn với
    /// AtomicTryReserveContestSlot: score là thời điểm hết hạn nên các entry tự dọn,
    /// và không có bước trả chỗ vì một suất sống lâu hơn cửa sổ thì không còn nghĩa gì.
    /// </summary>
    /// <remarks>
    /// member phải là duy nhất cho mỗi lần gọi, không phải mỗi challenge: dùng lại một
    /// member cũ sẽ trúng nhánh ZSCORE ở dưới và lần start đó không bị tính.
    /// </remarks>
    public async Task<bool> AtomicTryReserveStartSlot(
        string teamId,
        string member,
        long maxStarts,
        int windowSeconds)
    {
        if (maxStarts <= 0) return true;

        var zsetKey = $"team_start_window_{teamId}";
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var expireAt = now + windowSeconds;

        var script = @"
                    local zsetKey = KEYS[1]

                    local member = ARGV[1]
                    local maxStarts = tonumber(ARGV[2])
                    local now = tonumber(ARGV[3])
                    local expireAt = tonumber(ARGV[4])

                    -- Dọn các lần start đã ra khỏi cửa sổ trước khi đếm
                    redis.call('ZREMRANGEBYSCORE', zsetKey, '-inf', now)

                    if redis.call('ZSCORE', zsetKey, member) then
                        return 1
                    end

                    if redis.call('ZCARD', zsetKey) >= maxStarts then
                        return 0
                    end

                    redis.call('ZADD', zsetKey, expireAt, member)
                    redis.call('EXPIRE', zsetKey, expireAt - now)
                    return 1
                ";

        try
        {
            var result = await _cache.ScriptEvaluateAsync(
                script,
                keys: new RedisKey[] { zsetKey },
                values: new RedisValue[] { member, maxStarts, now, expireAt }
            );
            return (int)result == 1;
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"[Redis] Team start slot reservation failed: {ex.Message}");
            throw;
        }
    }

    /// <summary>
    /// Số giây còn lại của cooldown sau khi stop, 0 nếu đã hết hoặc chưa từng đặt.
    /// </summary>
    /// <remarks>
    /// Giá trị lưu là mốc hết hạn chứ không phải mốc bắt đầu, nên tính được số giây còn
    /// lại mà không cần hỏi TTL - và cũng không cần cấp thêm quyền TTL cho tài khoản.
    /// Một giá trị rác được đọc như hết cooldown: chặn nhầm một lần start hợp lệ tệ hơn
    /// là bỏ lọt một lần, và key này có TTL nên rác không sống lâu.
    /// </remarks>
    public async Task<long> GetDeployCooldownRemaining(string key, long nowSeconds)
    {
        var value = await _cache.StringGetAsync(key);

        if (value.IsNullOrEmpty) return 0;
        if (!long.TryParse(value, out var until)) return 0;

        var remaining = until - nowSeconds;
        return remaining > 0 ? remaining : 0;
    }

    /// <summary>
    /// Đặt cooldown tới mốc thời gian tuyệt đối; TTL của key trùng với chính cooldown đó
    /// nên không có key nào ở lại sau khi nó hết hiệu lực.
    /// </summary>
    public async Task<bool> SetDeployCooldown(string key, long nowSeconds, int cooldownSeconds)
    {
        if (cooldownSeconds <= 0) return false;

        return await _cache.StringSetAsync(
            key,
            nowSeconds + cooldownSeconds,
            TimeSpan.FromSeconds(cooldownSeconds));
    }

    /// <summary>
    /// Hàm này dành cho WORKER.
    /// Khi K8s Pod đã Ready, gọi hàm này để gia hạn thời gian sống chính thức (ví dụ 2h).
    /// </summary>
    /// <param name="teamId">ID của Team</param>
    /// <param name="deploymentKey">Key chứa data JSON</param>
    /// <param name="challengeId">ID bài thi (Unique ID trong ZSET)</param>
    /// <param name="realTtlSeconds">Thời gian sống thực tế (ví dụ 7200s = 2h)</param>
    /// <param name="deploymentValue">Data JSON cập nhật mới (tránh race condition)</param>
    public async Task<bool> AtomicUpdateExpiration(string teamId, string deploymentKey, string challengeId, int realTtlSeconds, string? deploymentValue = null)
    {
        var teamIdInt = int.Parse(teamId);
        var zsetKey = ChallengeHelper.GetZSetKKey(teamIdInt);

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var realExpiryScore = now + realTtlSeconds;

        var script = @"
                    local zsetKey = KEYS[1]
                    local deploymentKey = KEYS[2]
                    local uniqueId = ARGV[1]
                    local realExpiryScore = tonumber(ARGV[2])
                    local realTtl = tonumber(ARGV[3])
                    local deploymentValue = ARGV[4]
                    local teamId = tonumber(ARGV[5])

                    -- TRƯỜNG HỢP ĐẶC BIỆT: teamId <= 0 // Preview
                    -- Chỉ cần cập nhật deploymentKey, bỏ qua SAFETY CHECK và UPDATE SCORE
                    if teamId <= 0 then
                        if deploymentValue ~= '' then
                            redis.call('SETEX', deploymentKey, realTtl, deploymentValue)
                        else
                            redis.call('EXPIRE', deploymentKey, realTtl)
                        end
                        return 1 -- Success
                    end

                    -- TRƯỜNG HỢP BÌNH THƯỜNG: teamId > 0
                    -- 1. SAFETY CHECK: Kiểm tra xem challenge này còn trong danh sách không?
                    -- (Phòng trường hợp K8s deploy quá lâu > 5 phút, Redis đã tự dọn dẹp rồi)
                    -- Nếu không còn trong ZSET, ta không được phép hồi sinh nó (tránh zombie).
                    if redis.call('ZSCORE', zsetKey, uniqueId) == false then
                        return 0 -- Failed: Đã bị timeout, coi như deploy thất bại
                    end

                    -- 2. UPDATE SCORE: Cập nhật thời gian hết hạn CHÍNH THỨC trong ZSET
                    redis.call('ZADD', zsetKey, realExpiryScore, uniqueId)

                    -- 3. UPDATE DATA: Cập nhật data JSON mới (nếu có) để tránh race condition
                    if deploymentValue ~= '' then
                        redis.call('SETEX', deploymentKey, realTtl, deploymentValue)
                    else
                        redis.call('EXPIRE', deploymentKey, realTtl)
                    end

                    -- 4. MAINTENANCE: Gia hạn sự sống cho cả cái danh sách ZSET
                    redis.call('EXPIRE', zsetKey, realTtl + 3600)

                    return 1 -- Success
                ";

        try
        {
            var result = await _cache.ScriptEvaluateAsync(
                script,
                keys: new RedisKey[] { zsetKey, deploymentKey },
                values: new RedisValue[] { challengeId, realExpiryScore, realTtlSeconds, deploymentValue ?? "", teamIdInt }
            );

            return (int)result == 1;
        }
        catch (Exception ex)
        {
            await Console.Out.WriteLineAsync($"[Redis] Update Expiration Failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 3. HÀM REMOVE (Dùng chung cho cả Controller và Worker):
    /// - User bấm Stop.
    /// - Start bị lỗi (Rollback).
    /// - Worker phát hiện Pod Crash/Deleted.
    /// </summary>
    public async Task<bool> AtomicRemoveDeploymentZSet(string teamId, string deploymentKey, string challengeId)
    {
        var zsetKey = ChallengeHelper.GetZSetKKey(int.Parse(teamId));

        var script = @"
                    local zsetKey = KEYS[1]
                    local deploymentKey = KEYS[2]
                    local uniqueId = ARGV[1]

                    -- Xóa data JSON
                    redis.call('DEL', deploymentKey)

                    -- Xóa khỏi danh sách quản lý ZSET
                    return redis.call('ZREM', zsetKey, uniqueId)
                ";

        try
        {
            await _cache.ScriptEvaluateAsync(
                script,
                keys: new RedisKey[] { zsetKey, deploymentKey },
                values: new RedisValue[] { challengeId }
            );
            return true;
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"[Redis] Remove Failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Clears every trace of one challenge's deployments: the JSON key per team
    /// and that challenge's entry in each team's active-deployment ZSET.
    ///
    /// Deleting only the JSON keys - which is what a bare
    /// RemoveCacheByPattern("deploy_challenge_{id}_*") does - leaves the ZSET
    /// members behind, and those are what the reserve script counts. A team
    /// whose challenges were stopped that way keeps the slots on its limit and
    /// gets "already exists" when it tries the same challenge again, until the
    /// stale scores age out. The key name carries the team id, so no scan of
    /// the team keyspace is needed to find them.
    /// </summary>
    /// <returns>How many deployment records were removed.</returns>
    public async Task<int> RemoveDeploymentsForChallenge(int challengeId)
    {
        var prefix = $"deploy_challenge_{challengeId}_";
        var removed = 0;

        foreach (var key in GetKeysByPattern($"{prefix}*"))
        {
            var teamPart = key.Length > prefix.Length ? key[prefix.Length..] : string.Empty;

            // Team ids can be zero or negative - those are preview deployments,
            // and the reserve script gives them a ZSET entry like any other.
            if (int.TryParse(teamPart, out var teamId))
            {
                await AtomicRemoveDeploymentZSet(
                    teamId.ToString(),
                    key,
                    challengeId.ToString());
            }
            else
            {
                // Not a shape this method knows how to unwind; drop the key so
                // the sweep still leaves nothing behind.
                await RemoveCacheAsync(key);
            }

            removed++;
        }

        return removed;
    }

    // Get the underlying Redis database for advanced operations (INCR, DECR, etc.)
    public Task<IDatabase> GetDatabaseAsync()
    {
        return Task.FromResult(_cache);
    }

    // Lua script for atomic max attempts validation with smart sync
    // Returns: -1 if exceeded limit, otherwise returns new count after increment
    public async Task<long> CheckAndIncrementAttemptsAsync(string key, long maxAttempts, long smartSyncThreshold, int actualDbCount)
    {
        // Lua script that atomically:
        // 1. Gets current count
        // 2. If count > threshold, reset to DB count (smart sync)
        // 3. If count >= maxAttempts, return -1 (reject)
        // 4. Otherwise INCR and return new count
        var luaScript = @"
                    local key = KEYS[1]
                    local maxAttempts = tonumber(ARGV[1])
                    local smartSyncThreshold = tonumber(ARGV[2])
                    local actualDbCount = tonumber(ARGV[3])
                    local ttlSeconds = tonumber(ARGV[4])

                    local currentCount = redis.call('GET', key)

                    -- Case 1: Key missing → restore from DB
                    if not currentCount then
                        redis.call('SET', key, actualDbCount)
                        redis.call('EXPIRE', key, ttlSeconds)
                        currentCount = actualDbCount
                    else
                        currentCount = tonumber(currentCount)
                        
                        -- Ensure TTL exists
                        local keyttl = redis.call('TTL', key)
                        if keyttl < 0 then
                            redis.call('EXPIRE', key, ttlSeconds)
                        end
                    end

                    -- Pre-check + INCR + double-check
                    if currentCount >= maxAttempts then
                        return -1
                    end

                    -- Atomic increment
                    local newCount = redis.call('INCR', key)

                    -- Double check after increment
                    if newCount > maxAttempts then
                        return -1
                    end

                    return newCount
                ";

        try
        {
            var result = await _cache.ScriptEvaluateAsync(
                luaScript,
                [key],
                [maxAttempts, smartSyncThreshold, actualDbCount, 86400] // 24h TTL
            );

            return (long)result;
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"[Redis Lua] Error executing attempts check script: {ex.Message}");
            throw;
        }
    }

    // Atomic cooldown check-and-set
    // Returns -1 when allowed (timestamp updated), otherwise returns last timestamp
    public async Task<long> CheckAndUpdateCooldownAsync(string key, long nowSeconds, long cooldownSeconds, int ttlSeconds)
    {
        var luaScript = @"
                    local key = KEYS[1]
                    local now = tonumber(ARGV[1])
                    local cooldown = tonumber(ARGV[2])
                    local ttl = tonumber(ARGV[3])

                    local last = redis.call('GET', key)

                    if not last then
                        redis.call('SET', key, now)
                        redis.call('EXPIRE', key, ttl)
                        return -1
                    end

                    last = tonumber(last)
                    if (now - last) >= cooldown then
                        redis.call('SET', key, now)
                        redis.call('EXPIRE', key, ttl)
                        return -1
                    end

                    local keyttl = redis.call('TTL', key)
                    if keyttl < 0 then
                        redis.call('EXPIRE', key, ttl)
                    end

                    return last
                ";

        try
        {
            var result = await _cache.ScriptEvaluateAsync(
                luaScript,
                [key],
                [nowSeconds, cooldownSeconds, ttlSeconds]
            );

            return (long)result;
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"[Redis Lua] Error executing cooldown script: {ex.Message}");
            throw;
        }
    }
}

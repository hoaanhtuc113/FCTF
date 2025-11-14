using Newtonsoft.Json;
using StackExchange.Redis;
namespace SocialSync.Shared.Utils
{
    namespace ResourceShared.Utils
    {
        public class RedisHelper
        {
            private readonly IDatabase _cache;

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

            public async Task<List<T?>?> GetListFromCacheAsync<T>(List<string> keys)
            {
                try
                {
                    // Chuyển đổi List<string> sang RedisKey[]
                    RedisKey[] redisKeys = keys.Select(k => (RedisKey)k).ToArray();

                    // Lấy dữ liệu từ cache cho tất cả các keys
                    RedisValue[] values = await _cache.StringGetAsync(redisKeys);

                    // Khởi tạo danh sách để chứa các đối tượng sau khi deserialize
                    List<T?> resultList = new List<T?>();

                    foreach (var value in values)
                    {
                        if (!value.IsNullOrEmpty)
                        {
                            // Deserialize từng giá trị
                            T? deserializedValue = JsonConvert.DeserializeObject<T>(value);
                            resultList.Add(deserializedValue);
                        }
                        else
                        {
                            // Nếu giá trị null hoặc không tồn tại, thêm giá trị mặc định
                            resultList.Add(default);
                        }
                    }

                    return resultList;
                }
                catch (Exception)
                {
                    // Nếu có lỗi, trả về null
                    return null;
                }
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
                    var keys = new List<string>();
                    var endpoints = _cache.Multiplexer.GetEndPoints();

                    foreach (var endpoint in endpoints)
                    {
                        var server = _cache.Multiplexer.GetServer(endpoint);
                        if (server.IsConnected)
                        {
                            // Sử dụng phương thức Keys để lấy các key theo pattern
                            var foundKeys = server.Keys(pattern: pattern);
                            keys.AddRange(foundKeys.Select(k => k.ToString()));
                        }
                    }

                    return keys;
                }
                catch (Exception)
                {
                    // Nếu có lỗi, trả về danh sách rỗng
                    return new List<string>();
                }
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
        }
    }
}

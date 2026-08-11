using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ResourceShared.Utils;

public class SecretKeyHelper
{
    /// <summary>
    /// Hàm này sử dụng để tạo ra SecretKey tương tác với các Service khác
    /// </summary>
    /// <param name="unixTime"></param>
    /// <param name="data"></param>
    /// <returns></returns>
    ///
    /// The signed message names every field and states its length, so where one
    /// field ends and the next begins is itself signed. Joining the sorted values
    /// end to end was not: challengeId=12,teamId=34 and challengeId=1,teamId=234
    /// flatten to the same "1234", so a signature captured for one request stayed
    /// valid for the other, and anyone sitting in the plaintext hop between the
    /// services could move the boundaries without knowing PRIVATE_KEY. Fields
    /// nothing downstream reads - challengeName, ns - made good filler for that.
    ///
    /// HMAC-SHA256 rather than MD5 of key-then-data: the old construction placed
    /// the secret inside a hash whose output travels with the request, which is
    /// the shape length extension needs. It survived only because the last field
    /// in sort order happened to be an integer that could not carry padding
    /// bytes - one added string field sorting after it would have been enough.
    ///
    /// Every implementation of this scheme has to change together, since both
    /// sides recompute the same message: CTFd's create_secret_key (Python, four
    /// copies) and the status callback in the up-challenge Argo template (sh).
    public static string CreateSecretKey(long unixTime, Dictionary<string, string> data)
    {
        var privateKey = Environment.GetEnvironmentVariable("PRIVATE_KEY")
            ?? throw new InvalidOperationException("Missing PRIVATE_KEY");

        var message = new StringBuilder();
        message.Append(unixTime).Append('\n');

        // Ordinal rather than the culture-aware default of OrderBy: the Python
        // and shell signers order by byte value, and all three have to agree.
        foreach (var param in data.OrderBy(x => x.Key, StringComparer.Ordinal))
        {
            var value = param.Value ?? string.Empty;

            message.Append(param.Key)
                .Append('=')
                .Append(Encoding.UTF8.GetByteCount(value))
                .Append(':')
                .Append(value)
                .Append('\n');
        }

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(privateKey));
        var signature = hmac.ComputeHash(Encoding.UTF8.GetBytes(message.ToString()));

        return Convert.ToHexString(signature).ToLowerInvariant();
    }

    /// <summary>
    /// Builds the signing dictionary directly from the exact object that will be sent as the
    /// JSON request body, instead of a hand-picked subset of its fields. RequireSecretKeyAttribute
    /// on the receiving side recomputes the hash from the FULL request body (minus unixTime), so
    /// any field present on the payload but missing here silently breaks the signature check —
    /// which is exactly what happened when `flagValue`/`ns`/`contestId`/`challengeName` were added
    /// to ChallengeStartStopReqDTO but the hand-picked signing dict was never updated to match.
    /// </summary>
    public static string CreateSecretKeyFromObject(long unixTime, object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        var parsed = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)
            ?? new Dictionary<string, JsonElement>();

        var data = new Dictionary<string, string>();
        foreach (var (key, value) in parsed)
        {
            if (key == "unixTime") continue;

            data[key] = value.ValueKind switch
            {
                JsonValueKind.Null or JsonValueKind.Undefined => string.Empty,
                JsonValueKind.String => value.GetString() ?? string.Empty,
                _ => value.ToString(),
            };
        }

        return CreateSecretKey(unixTime, data);
    }

}

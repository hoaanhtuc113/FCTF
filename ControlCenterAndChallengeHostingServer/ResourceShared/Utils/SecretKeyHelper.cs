using System.Text;
using System.Text.Json;

namespace ResourceShared.Utils;

public class SecretKeyHelper
{
    /// <summary>
    /// Hàm này sử dụng để tạo ra SecretKey tương tác với các Service khác
    /// </summary>
    /// <param name="privateKey">Private Key được config tại appsettings.json</param>
    /// <param name="unixTime"></param>
    /// <param name="data"></param>
    /// <returns></returns>
    public static string CreateSecretKey(long unixTime, Dictionary<string, string> data)
    {
        // Sort parameters by key (a-z)
        var sortedParams = data.OrderBy(x => x.Key);
        var privateKey = Environment.GetEnvironmentVariable("PRIVATE_KEY")
            ?? throw new InvalidOperationException("Missing PRIVATE_KEY");

        // Concatenate UnixTime, PrivateKey, and sorted parameter values
        var stringBuilder = new StringBuilder();
        stringBuilder.Append(unixTime);
        stringBuilder.Append(privateKey);
        foreach (var param in sortedParams)
        {
            stringBuilder.Append(param.Value ?? "1");
        }

        string EncryptedKey = MD5Helper.GenerateMD5Hash(stringBuilder.ToString());
        return EncryptedKey;
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

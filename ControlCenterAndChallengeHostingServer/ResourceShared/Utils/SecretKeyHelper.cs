using System.Text;

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

}

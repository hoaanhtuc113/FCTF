using ResourceShared.Configs;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace ResourceShared.Utils
{
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

            // Concatenate UnixTime, PrivateKey, and sorted parameter values
            var stringBuilder = new StringBuilder();
            stringBuilder.Append(unixTime);
            stringBuilder.Append(SharedConfig.PRIVATE_KEY);
            foreach (var param in sortedParams)
            {
                stringBuilder.Append(param.Value ?? "1");
            }

            string EncryptedKey = MD5Helper.GenerateMD5Hash(stringBuilder.ToString());
            return EncryptedKey;
        }

    }
}

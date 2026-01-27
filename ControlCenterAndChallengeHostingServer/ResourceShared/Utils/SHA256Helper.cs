using BCrypt.Net;
using ResourceShared.Models;
using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace ResourceShared.Utils
{
    public class SHA256Helper
    {
        public static string HashPasswordPythonStyle(string plaintext)
        {
            // generate bcrypt salt (22 chars) using BCrypt.Net (cost=10)
            string salt = BCrypt.Net.BCrypt.GenerateSalt(10); // returns e.g. "$2b$10$<22salt>"
            var parts = salt.Split('$'); // ["", "2b", "10", "<22salt>"]
            string type = parts[1];      // "2b"
            string cost = parts[2];      // "10"
            string salt22 = parts[3];    // "<22salt>"

            // v2: prehash with HMAC-SHA256 keyed by salt22
            string prehashedBase64 = HmacSha256Base64(plaintext, salt22);
            string inner = BCrypt.Net.BCrypt.HashPassword(prehashedBase64, salt);

            string digest31 = inner.Substring(inner.LastIndexOf('$') + 1).Substring(22);

            // v2 format: $bcrypt-sha256$v=2,t=2b,r=12$<salt22>$<digest31>
            return $"$bcrypt-sha256$v=2,t={type},r={cost}${salt22}${digest31}";
        }

        public static bool VerifyPassword(string plaintext, string passlibHash)
        {
            if (string.IsNullOrWhiteSpace(passlibHash) || !passlibHash.StartsWith("$bcrypt-sha256$"))
                throw new ArgumentException("Not a passlib bcrypt_sha256 hash.", nameof(passlibHash));

            var v2 = new Regex(@"\$bcrypt-sha256\$v=2,t=(?<type>2[ab]),r=(?<rounds>\d{1,2})\$(?<salt>[./A-Za-z0-9]{22})\$(?<digest>[./A-Za-z0-9]{31})$", RegexOptions.None, TimeSpan.FromMilliseconds(100));
            Match m = v2.Match(passlibHash);
            if (!m.Success) throw new ArgumentException("Unrecognized bcrypt_sha256 format (only v2 supported).", nameof(passlibHash));

            string type = m.Groups["type"].Value;
            string rounds = m.Groups["rounds"].Value;
            string salt22 = m.Groups["salt"].Value;
            string digest31 = m.Groups["digest"].Value;

            string roundsPadded = rounds.PadLeft(2, '0');
            string innerBcryptHash = $"${type}${roundsPadded}${salt22}{digest31}";
            string prehashedBase64 = HmacSha256Base64(plaintext, salt22); // v2 prehash

            return BCrypt.Net.BCrypt.Verify(prehashedBase64, innerBcryptHash);
        }

        private static string HmacSha256Base64(string message, string keyAscii)
        {
            using var h = new HMACSHA256(Encoding.ASCII.GetBytes(keyAscii));
            byte[] mac = h.ComputeHash(Encoding.UTF8.GetBytes(message));
            return Convert.ToBase64String(mac); // includes '=' padding, as passlib does
        }
    }
}

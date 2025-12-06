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
        private static string Sha256Hex(string plaintext)
        {
            using (var sha = SHA256.Create())
            {
                var hashed = sha.ComputeHash(Encoding.UTF8.GetBytes(plaintext));
                return BitConverter.ToString(hashed).Replace("-", "").ToLowerInvariant();
            }
        }

        public static string HashPassword(string plaintext)
        {
            string rawSha = Sha256Hex(plaintext);
            return BCrypt.Net.BCrypt.HashPassword(rawSha);
        }

        public static string HashPasswordPythonStyle(string plaintext)
        {
            // generate bcrypt salt (22 chars) using BCrypt.Net
            string salt = BCrypt.Net.BCrypt.GenerateSalt(12); // returns e.g. "$2b$12$<22salt>"
            var parts = salt.Split('$'); // ["", "2b", "12", "<22salt>"]
            string type = parts[1];      // "2b"
            string cost = parts[2];      // "12"
            string salt22 = parts[3];    // "<22salt>"

            string prehashedBase64 = HmacSha256Base64(plaintext, salt22);
            string inner = BCrypt.Net.BCrypt.HashPassword(prehashedBase64, salt);

            string digest31 = inner.Substring(inner.LastIndexOf('$') + 1).Substring(22);

            return $"$bcrypt-sha256$v=2,t={type},r={cost}${salt22}${digest31}";
        }

        public static bool VerifyPassword(string plaintext, string passlibHash)
        {
            if (string.IsNullOrWhiteSpace(passlibHash) || !passlibHash.StartsWith("$bcrypt-sha256$"))
                throw new ArgumentException("Not a passlib bcrypt_sha256 hash.", nameof(passlibHash));

            var v2 = new Regex(@"\$bcrypt-sha256\$v=2,t=(?<type>2[ab]),r=(?<rounds>\d{1,2})\$(?<salt>[./A-Za-z0-9]{22})\$(?<digest>[./A-Za-z0-9]{31})$", RegexOptions.None, TimeSpan.FromMilliseconds(100));
            var v1 = new Regex(@"\$bcrypt-sha256\$(?<type>2[ab]),(?<rounds>\d{1,2})\$(?<salt>[./A-Za-z0-9]{22})\$(?<digest>[./A-Za-z0-9]{31})$", RegexOptions.None, TimeSpan.FromMilliseconds(100));

            Match m = v2.Match(passlibHash);
            int version = 2;
            if (!m.Success)
            {
                m = v1.Match(passlibHash);
                version = 1;
            }
            if (!m.Success) throw new ArgumentException("Unrecognized bcrypt_sha256 format.", nameof(passlibHash));

            string type = m.Groups["type"].Value;
            string rounds = m.Groups["rounds"].Value; 
            string salt22 = m.Groups["salt"].Value;  
            string digest31 = m.Groups["digest"].Value;

            string roundsPadded = rounds.PadLeft(2, '0');
            string innerBcryptHash = $"${type}${roundsPadded}${salt22}{digest31}";
            string prehashedBase64 = version == 2
                ? HmacSha256Base64(message: plaintext, keyAscii: salt22)   // v=2 uses HMAC-SHA256 with key = salt string
                : Sha256Base64(plaintext);                                 // v=1 used plain SHA256

            return BCrypt.Net.BCrypt.Verify(prehashedBase64, innerBcryptHash);
        }

        private static string HmacSha256Base64(string message, string keyAscii)
        {
            using var h = new HMACSHA256(Encoding.ASCII.GetBytes(keyAscii));
            byte[] mac = h.ComputeHash(Encoding.UTF8.GetBytes(message));
            return Convert.ToBase64String(mac); // includes '=' padding, as passlib does
        }

        private static string Sha256Base64(string message)
        {
            using var sha = SHA256.Create();
            byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(message));
            return Convert.ToBase64String(hash);
        }
    }
}

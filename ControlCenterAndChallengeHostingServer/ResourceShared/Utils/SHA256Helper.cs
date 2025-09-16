using System;
using System.Text;
using System.Security.Cryptography;
using BCrypt.Net;

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

        // Hash trả về trực tiếp bcrypt string (vd: $2b$12$...)
        public static string HashPassword(string plaintext)
        {
            string rawSha = Sha256Hex(plaintext);
            return BCrypt.Net.BCrypt.HashPassword(rawSha);
        }

        // Nếu muốn lưu theo kiểu Python ($bcrypt-sha256$...), dùng hàm này
        public static string HashPasswordPythonStyle(string plaintext)
        {
            string bcrypt = HashPassword(plaintext); // $2b$12$<salt+hash>
            var parts = bcrypt.Split('$'); // ["", "2b", "12", "<salt+hash>"]
            if (parts.Length >= 4)
            {
                string type = parts[1];
                string rounds = parts[2];
                string saltAndHash = parts[3];

                // salt = first 22 chars, hash = rest (31 chars), chuẩn bcrypt
                if (saltAndHash.Length >= 53)
                {
                    string salt = saltAndHash.Substring(0, 22);
                    string hash = saltAndHash.Substring(22);
                    return $"$bcrypt-sha256$v=2,t={type},r={rounds}${salt}${hash}";
                }

                // Fallback (nếu không đúng độ dài): ghép lại theo cách đơn giản
                string saltFallback = saltAndHash.Length > 22 ? saltAndHash.Substring(0, 22) : saltAndHash;
                string hashFallback = saltAndHash.Length > 22 ? saltAndHash.Substring(22) : "";
                return $"$bcrypt-sha256$v=2,t={type},r={rounds}${saltFallback}${hashFallback}";
            }

            return bcrypt; // fallback: trả bcrypt gốc
        }

        public static bool VerifyPassword(string plaintext, string storedHash)
        {
            string rawSha = Sha256Hex(plaintext);

            if (!string.IsNullOrEmpty(storedHash) && storedHash.StartsWith("$bcrypt-sha256$"))
            {
                // storedHash: $bcrypt-sha256$v=2,t=2b,r=12$<salt>$<hash>
                var parts = storedHash.Split('$'); // ["", "bcrypt-sha256", "v=2,t=2b,r=12", "<salt>", "<hash>", ...]
                if (parts.Length < 5) return false;

                var settings = parts[2].Split(',');
                string type = null, rounds = null;
                foreach (var s in settings)
                {
                    if (s.StartsWith("t=")) type = s.Substring(2);
                    if (s.StartsWith("r=")) rounds = s.Substring(2);
                }
                if (string.IsNullOrEmpty(type) || string.IsNullOrEmpty(rounds)) return false;

                string salt = parts[3];
                string hash = parts[4];

                // IMPORTANT: không thêm '$' giữa salt và hash — ghép trực tiếp
                string saltAndHash = salt + hash; // => <22+31 chars>
                string realHash = "$" + type + "$" + rounds + "$" + saltAndHash;

                // (Tùy chọn) debug:
                Console.WriteLine($"rawSha: {rawSha}"); // phải là 64 ký tự hex
                Console.WriteLine($"storedHash: {storedHash}");
                Console.WriteLine($"realHash: {realHash}"); // phải bắt đầu bằng $2b$12$ và có độ dài 60
                Console.WriteLine($"realHash.Length: {realHash.Length}"); // bcrypt chuẩn = 60

                return BCrypt.Net.BCrypt.Verify(rawSha, realHash);
            }
            else
            {
                // stored hash đã là bcrypt thuần ($2b$12$...)
                return BCrypt.Net.BCrypt.Verify(rawSha, storedHash);
            }
        }
    }
}

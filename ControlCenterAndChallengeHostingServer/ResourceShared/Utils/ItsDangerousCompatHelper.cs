using ResourceShared.Configs;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ResourceShared.Utils
{
    public class ItsDangerousCompatHelper
    {
        private static string secret = SharedConfig.PRIVATE_KEY;
        static int UnixNow() => (int)DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        // serialize
        public static string Dumps(object data, string salt = "itsdangerous")
        {
            // itsdangerous URLSafeTimedSerializer: base64(JSON) rồi TimestampSigner ký. 
            // JSON compact (no spaces) tương đương compact_json. 
            var json = JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = false });
            var payload = B64Url(Encoding.UTF8.GetBytes(json));
            return TimestampSign(payload, secret, salt);
        }

        // unserialize
        public static T Loads<T>(string token, int? maxAgeSeconds = 432000, string salt = "itsdangerous")
        {
            var payloadB64 = TimestampUnsign(token, secret, maxAgeSeconds, salt);
            var json = Encoding.UTF8.GetString(B64UrlDecode(payloadB64));
            return JsonSerializer.Deserialize<T>(json);
        }

        // public static string Sign(string value, string salt = "itsdangerous.Signer", char sep = '.')
        // {
        //     var valBytes = Encoding.UTF8.GetBytes(value);
        //     var key = DeriveKey(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(salt));
        //     var sig = HmacSha1(key, valBytes);
        //     return value + sep + B64Url(sig);
        // }

        // public static string Unsign(string signed, string salt = "itsdangerous.Signer", char sep = '.')
        // {
        //     var idx = signed.LastIndexOf(sep);
        //     if (idx < 0) throw new InvalidOperationException("No separator");
        //     var value = signed.Substring(0, idx);
        //     var sigB64 = signed.Substring(idx + 1);
        //     var key = DeriveKey(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(salt));
        //     var expect = B64Url(HmacSha1(key, Encoding.UTF8.GetBytes(value)));
        //     if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(sigB64), Encoding.ASCII.GetBytes(expect)))
        //         throw new InvalidOperationException("BadSignature");
        //     return value;
        // }
     
        public static string TimestampSign(string value, string secret, string salt = "itsdangerous", char sep = '.')
        {
            var tsPart = B64Url(IntToBytesBE(UnixNow()));     // base64url(int_to_bytes(ts))
            var valueWithTs = value + sep + tsPart;

            var key = DeriveKey(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(salt));
            var sig = HmacSha1(key, Encoding.UTF8.GetBytes(valueWithTs));
            return valueWithTs + sep + B64Url(sig);           // value.ts.sig
        }

        public static string TimestampUnsign(string token, string secret, int? maxAgeSeconds = null, string salt = "itsdangerous", char sep = '.')
        {
            var parts = token.Split(sep);
            if (parts.Length < 3) throw new InvalidOperationException("timestamp missing");

            var value = string.Join(sep, parts, 0, parts.Length - 2);
            var tsB64 = parts[^2];
            var sigB64 = parts[^1];

            var valueWithTs = value + sep + tsB64;
            var key = DeriveKey(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(salt));
            var expect = B64Url(HmacSha1(key, Encoding.UTF8.GetBytes(valueWithTs)));

            if (!CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(sigB64), Encoding.ASCII.GetBytes(expect)))
                throw new InvalidOperationException("BadSignature");

            // age check
            var tsBytes = B64UrlDecode(tsB64);
            int ts = 0; foreach (var b in tsBytes) ts = (ts << 8) | b;
            if (maxAgeSeconds is int maxAge)
            {
                var age = UnixNow() - ts;
                if (age > maxAge) throw new InvalidOperationException($"SignatureExpired: age {age} > {maxAge}");
            }
            return value;
        }

        static string B64Url(byte[] bytes)
        {
            var s = Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
            return s;
        }
        static byte[] B64UrlDecode(string s)
        {
            s = s.Replace('-', '+').Replace('_', '/');
            switch (s.Length % 4) { case 2: s += "=="; break; case 3: s += "="; break; }
            return Convert.FromBase64String(s);
        }
        static byte[] IntToBytesBE(int n)
        {
            // minimal big-endian (không zero-leading), giống itsdangerous int_to_bytes
            if (n == 0) return new byte[] { 0 };
            Span<byte> tmp = stackalloc byte[8];
            int i = 8;
            while (n > 0) { tmp[--i] = (byte)(n & 0xFF); n >>= 8; }
            return tmp.Slice(i).ToArray();
        }

        static byte[] DeriveKey(byte[] secret, byte[] salt) // django-concat
        {
            // sha1(salt + "signer" + secret)
            using var sha1 = SHA1.Create();
            var data = new byte[salt.Length + 6 + secret.Length];
            Buffer.BlockCopy(salt, 0, data, 0, salt.Length);
            var tag = Encoding.ASCII.GetBytes("signer");
            Buffer.BlockCopy(tag, 0, data, salt.Length, 6);
            Buffer.BlockCopy(secret, 0, data, salt.Length + 6, secret.Length);
            return sha1.ComputeHash(data);
        }

        static byte[] HmacSha1(byte[] key, byte[] msg)
        {
            using var h = new HMACSHA1(key);
            return h.ComputeHash(msg);
        }
    }
}

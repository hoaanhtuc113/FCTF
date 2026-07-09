using System;
using System.Security.Cryptography;
using System.Text;

namespace ResourceShared.Utils;

public static class AesHelper
{
    private static byte[] GetKey()
    {
        var raw = Encoding.UTF8.GetBytes(Environment.GetEnvironmentVariable("KYPO_AES_KEY") ?? "");
        var key = new byte[32];
        Array.Copy(raw, key, Math.Min(raw.Length, 32));
        return key;
    }

    public static string Decrypt(string ciphertext)
    {
        var raw = Convert.FromBase64String(ciphertext);
        using var aes = Aes.Create();
        aes.Key = GetKey();
        aes.IV = raw[..16];
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        using var dec = aes.CreateDecryptor();
        var plain = dec.TransformFinalBlock(raw, 16, raw.Length - 16);
        return Encoding.UTF8.GetString(plain);
    }

    public static string Encrypt(string plaintext)
    {
        using var aes = Aes.Create();
        aes.Key = GetKey();
        aes.GenerateIV();
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        using var enc = aes.CreateEncryptor();
        var data = Encoding.UTF8.GetBytes(plaintext);
        var ct = enc.TransformFinalBlock(data, 0, data.Length);
        var result = new byte[16 + ct.Length];
        aes.IV.CopyTo(result, 0);
        ct.CopyTo(result, 16);
        return Convert.ToBase64String(result);
    }
}

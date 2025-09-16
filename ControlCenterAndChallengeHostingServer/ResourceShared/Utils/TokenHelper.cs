using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.Utils
{
    public static class TokenHelper
    {

        public static async Task<Token> GenerateUserToken(AppDbContext db, User user,
                                                  DateTime? expiration = null,
                                                  string description = null)
        {
            string value;
            do
            {
                value = "ctfd_" + HexEncode(RandomBytes(32));
            } while (await db.Tokens.AnyAsync(t => t.Value == value));

            var token = new Token
            {
                UserId = user.Id,
                Expiration = expiration,
                Description = description,
                Value = value
            };

            db.Tokens.Add(token);
            await db.SaveChangesAsync();
            return token;
        }
        private static string HexEncode(byte[] bytes) =>
        BitConverter.ToString(bytes).Replace("-", "").ToLower();
        private static byte[] RandomBytes(int length)
        {
            var bytes = new byte[length];
            RandomNumberGenerator.Fill(bytes);
            return bytes;
        }
    }
}

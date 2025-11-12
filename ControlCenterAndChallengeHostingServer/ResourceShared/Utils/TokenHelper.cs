using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ResourceShared.DTOs.Auth;
using ResourceShared.Models;
using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net.Http;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
namespace ResourceShared.Utils
{
    public class TokenHelper
    {
        private readonly string SecretKey = SharedConfig.PRIVATE_KEY;
        private readonly AppDbContext _context;
        public TokenHelper(AppDbContext context)
        {
            _context = context;
        }
        public async Task<Token> GenerateUserToken( User user,
                                                  DateTime? expiration = null,
                                                  string description = null)
        {   
            AuthInfo authInfo = new AuthInfo
            {
                userId = user.Id,
                teamId = user.TeamId ?? 0
            };
            var value = CreateToken<AuthInfo>(authInfo, expireMinutes: 60 * 24 * 7); // 7 days
            var token = new Token
            {
                UserId = user.Id,
                Expiration = expiration,
                Description = description,
                Value = value,
                Type = Enums.UserType.User
            };

            _context.Tokens.Add(token);
            await _context.SaveChangesAsync();
            return token;
        }

        public string CreateToken<T>(T payload, int expireMinutes = 60)
        {
            var claims = payload!.GetType()
                .GetProperties()
                .Select(p => new Claim(p.Name, p.GetValue(payload)?.ToString() ?? ""));

            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SecretKey));
            var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var token = new JwtSecurityToken(
                claims: claims,
                expires: DateTime.UtcNow.AddMinutes(expireMinutes),
                signingCredentials: creds
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }
}

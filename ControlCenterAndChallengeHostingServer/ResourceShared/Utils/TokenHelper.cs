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
        private readonly DbContextOptions<AppDbContext> _dbOptions;
        
        public TokenHelper(DbContextOptions<AppDbContext> dbOptions)
        {
            _dbOptions = dbOptions;
        }
        
        public async Task<Token> GenerateUserToken(User user,
                                                  DateTime? expiration = null,
                                                  string description = null)
        {
            using (var context = new AppDbContext(_dbOptions))
            {
                // Tạo UUID unique cho mỗi lần login
                var tokenUuid = Guid.NewGuid().ToString();
                
                AuthInfo authInfo = new AuthInfo
                {
                    userId = user.Id,
                    teamId = user.TeamId ?? 0
                };
                var value = CreateToken(authInfo, tokenUuid, expireMinutes: 60 * 24 * 7); // 7 days
                
                // Kiểm tra xem user đã có token chưa
                var existingToken = await context.Tokens
                    .FirstOrDefaultAsync(t => t.UserId == user.Id && t.Type == Enums.UserType.User);
                
                if (existingToken != null)
                {
                    // Update token hiện tại với UUID mới
                    existingToken.Value = tokenUuid; // Chỉ lưu UUID
                    existingToken.Expiration = expiration;
                    existingToken.Description = description;
                    context.Tokens.Update(existingToken);
                    await context.SaveChangesAsync();
                    
                    // Trả về token với JWT value (không phải UUID)
                    existingToken.Value = value;
                    return existingToken;
                }
                else
                {
                    // Tạo token mới
                    var token = new Token
                    {
                        UserId = user.Id,
                        Expiration = expiration,
                        Description = description,
                        Value = tokenUuid, // Lưu UUID vào DB
                        Type = Enums.UserType.User
                    };
                    context.Tokens.Add(token);
                    await context.SaveChangesAsync();
                    
                    // Trả về token với JWT value
                    token.Value = value;
                    return token;
                }
            }
        }

        public string CreateToken(AuthInfo payload, string tokenUuid, int expireMinutes = 60)
        {
            var claims = payload!.GetType()
                .GetProperties()
                .Select(p => new Claim(p.Name, p.GetValue(payload)?.ToString() ?? ""))
                .ToList();
            
            claims.Add(new Claim(ClaimTypes.NameIdentifier, payload.userId.ToString()));
            
            // Thêm UUID claim để phân biệt mỗi lần đăng nhập
            claims.Add(new Claim("tokenUuid", tokenUuid));

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

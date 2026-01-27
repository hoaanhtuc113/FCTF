using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ResourceShared.DTOs.Auth;
using ResourceShared.Models;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
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

        public async Task<string> GenerateUserToken(
            User user,
            DateTime? expiration = null,
            string description = null)
        {
            // Tạo UUID unique cho mỗi lần login
            var tokenUuid = Guid.NewGuid().ToString();

            AuthInfo authInfo = new()
            {
                userId = user.Id,
                teamId = user.TeamId ?? 0
            };
            var jwt = CreateToken(authInfo, tokenUuid, expireMinutes: 60 * 24 * 7); // 7 days

            // Kiểm tra xem user đã có token chưa
            var existingToken = await _context.Tokens
                .FirstOrDefaultAsync(t => t.UserId == user.Id && t.Type == Enums.UserType.User);

            if (existingToken != null)
            {
                // Update token hiện tại với UUID mới
                existingToken.Value = tokenUuid; // Chỉ lưu UUID
                existingToken.Expiration = expiration;
                existingToken.Description = description;
                // Trả về token với JWT value (không phải UUID)
                return jwt;
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
                _context.Tokens.Add(token);
                // Trả về token với JWT value
                return jwt;
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

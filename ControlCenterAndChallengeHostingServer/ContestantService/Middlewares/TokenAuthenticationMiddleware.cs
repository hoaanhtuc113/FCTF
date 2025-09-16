using Microsoft.EntityFrameworkCore;
using ResourceShared.Models;

namespace ContestantService.Middlewares
{
    public class TokenAuthenticationMiddleware
    {
        private readonly RequestDelegate _next;

        public TokenAuthenticationMiddleware(RequestDelegate next)
        {
            _next = next;
        }

        public async Task Invoke(HttpContext context, AppDbContext db)
        {
            try
            {
                var authHeader = context.Request.Headers["Authorization"].FirstOrDefault();
                var token = authHeader.Substring("Bearer ".Length).Trim();
                var tokenAuth = await db.Tokens.FirstOrDefaultAsync(t => t.Value == token);
                if (tokenAuth != null)
                {
                    var user = await db.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == tokenAuth.UserId);
                    if (user != null)
                    {
                        context.Items["CurrentUser"] = user;
                    }            
                }
                      
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AuthMiddleware] Error: {ex.Message}\n{ex.StackTrace}");
            }

            await _next(context);
        }
    }
}

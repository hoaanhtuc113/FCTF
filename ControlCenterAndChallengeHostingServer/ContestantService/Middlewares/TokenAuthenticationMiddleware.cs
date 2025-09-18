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

        public async Task Invoke(HttpContext context)
        {
            try
            {
                var authHeader = context.Request.Headers["Authorization"].FirstOrDefault();

                if (!string.IsNullOrEmpty(authHeader) && authHeader.StartsWith("Bearer "))
                {
                    var token = authHeader.Substring("Bearer ".Length).Trim();

                    if (!string.IsNullOrEmpty(token))
                    {
                        using (var db = new AppDbContext())
                        {
                            var tokenAuth = await db.Tokens.FirstOrDefaultAsync(t => t.Value == token);
                            if (tokenAuth != null)
                            {
                                var user = await db.Users.FirstOrDefaultAsync(u => u.Id == tokenAuth.UserId);
                                if (user != null)
                                {
                                    context.Items["CurrentUser"] = user;
                                }
                            }
                        }
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

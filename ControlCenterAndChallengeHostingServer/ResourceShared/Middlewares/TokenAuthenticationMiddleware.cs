using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ResourceShared.Attribute;
using ResourceShared.Models;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace ResourceShared.Middlewares
{
    public class TokenAuthenticationMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly IServiceScopeFactory _scopeFactory;

        public TokenAuthenticationMiddleware(RequestDelegate next, IServiceScopeFactory scopeFactory)
        {
            _next = next;
            _scopeFactory = scopeFactory;
        }

        public async Task Invoke(HttpContext context)
        {
            var endpoint = context.GetEndpoint();
            var requireAuth = endpoint?.Metadata.GetMetadata<RequireAuthAttribute>() != null;

            if (!requireAuth)
            {
                await _next(context);
                return;
            }

            User authenticatedUser = null;

            try
            {
                var authHeader = context.Request.Headers["Authorization"].FirstOrDefault();

                if (!string.IsNullOrEmpty(authHeader) && authHeader.StartsWith("Bearer "))
                {
                    var token = authHeader.Substring("Bearer ".Length).Trim();

                    using var scope = _scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                    if (!string.IsNullOrEmpty(token))
                    {
                        var tokenAuth = await db.Tokens.FirstOrDefaultAsync(t => t.Value == token);
                        if (tokenAuth != null)
                        {
                            var user = await db.Users.Include(u => u.Team).FirstOrDefaultAsync(u => u.Id == tokenAuth.UserId);
                            if (user != null)
                            {
                                // Check if user is Hidden or Banned before setting as authenticated
                                if ((user.Hidden != true) && (user.Banned != true))
                                {
                                    authenticatedUser = user;
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

            // If RequireAuth is set but user is not authenticated, return 401
            if (requireAuth && authenticatedUser == null)
            {
                context.Response.StatusCode = 401;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync("{\"message\":\"Unauthorized\"}");
                return;
            }

            await _next(context);
        }

    }
}

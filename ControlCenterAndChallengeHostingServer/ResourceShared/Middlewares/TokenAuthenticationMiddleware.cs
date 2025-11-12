using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ResourceShared.Attribute;
using ResourceShared.Models;
using System;
using System.Linq;
using System.Security.Claims;
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

        public async Task InvokeAsync(HttpContext context, AppDbContext db)
        {
            var endpoint = context.GetEndpoint();
            var authorizeAttribute = endpoint?.Metadata.GetMetadata<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>();
            
            // Only check for endpoints with [Authorize]
            if (authorizeAttribute != null && context.User.Identity?.IsAuthenticated == true)
            {
                var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);

                // Validate userId exists and can be parsed to int
                if (string.IsNullOrEmpty(userId) || !int.TryParse(userId, out var id))
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    await context.Response.WriteAsync("Invalid user token.");
                    return;
                }
                //Console.WriteLine($"Authenticated user ID: {id}");
                // Check user status in database
                var user = await db.Users
                    .Where(u => u.Id == id)
                    .Select(u => new { u.Banned, u.Hidden })
                    .FirstOrDefaultAsync();

                if (user == null)
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    await context.Response.WriteAsync("User not found.");
                    return;
                }

                if (user.Banned == true)
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsync("Account banned.");
                    return;
                }

                if (user.Hidden == true)
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsync("Account hidden.");
                    return;
                }
            }

            await _next(context);
        }

    }
}

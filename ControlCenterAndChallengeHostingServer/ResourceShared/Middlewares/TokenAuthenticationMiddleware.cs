using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ResourceShared.Attribute;
using ResourceShared.Models;
using ResourceShared.Logger;
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
            try
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
                    var tokens = await db.Tokens
                        .Where(t => t.UserId == id && t.Type == Enums.UserType.User)
                        .FirstOrDefaultAsync();
                    if( tokens == null)
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("Token not found.");
                        return;
                    }
                    if(tokens.Value == null || !tokens.Value.Equals(context.User.FindFirstValue("tokenUuid")))
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("Invalid user token");
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
            catch (Exception ex)
            {
                using (var scope = _scopeFactory.CreateScope())
                {
                    var logger = scope.ServiceProvider.GetRequiredService<AppLogger>();
                    var userId = context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
                    int.TryParse(userId, out var id);
                    logger.LogError(ex, id > 0 ? id : null, data: new { path = context.Request.Path });
                }
                
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                await context.Response.WriteAsync("An error occurred while processing your request.");
            }
        }

    }
}

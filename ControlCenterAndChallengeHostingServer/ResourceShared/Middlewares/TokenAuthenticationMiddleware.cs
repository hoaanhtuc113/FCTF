using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ResourceShared.Logger;
using ResourceShared.Models;
using System.Security.Claims;

namespace ResourceShared.Middlewares
{
    public class TokenAuthenticationMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly IServiceScopeFactory _scopeFactory;

        public TokenAuthenticationMiddleware(
            RequestDelegate next,
            IServiceScopeFactory scopeFactory)
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

                if (authorizeAttribute != null && context.User.Identity?.IsAuthenticated == true)
                {
                    var userIdStr = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
                    if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out var id))
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("Invalid user token.");
                        return;
                    }

                    var authInfo = await db.Users
                        .AsNoTracking()
                        .Where(u => u.Id == id)
                        .Select(u => new
                        {
                            u.Banned,
                            u.Hidden,
                            TokenValueFromDb = db.Tokens
                                .Where(t => t.UserId == id && t.Type == Enums.UserType.User)
                                .Select(t => t.Value)
                                .FirstOrDefault()
                        })
                        .FirstOrDefaultAsync();

                    if (authInfo == null)
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("User not found.");
                        return;
                    }

                    var tokenUuidFromClaim = context.User.FindFirstValue("tokenUuid");
                    if (string.IsNullOrEmpty(authInfo.TokenValueFromDb) || !authInfo.TokenValueFromDb.Equals(tokenUuidFromClaim))
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("Invalid user token");
                        return;
                    }

                    if (authInfo.Banned == true)
                    {
                        context.Response.StatusCode = StatusCodes.Status403Forbidden;
                        await context.Response.WriteAsync("Account banned.");
                        return;
                    }

                    if (authInfo.Hidden == true)
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
                    _ = int.TryParse(userId, out var id);
                    logger.LogError(ex, id > 0 ? id : null, data: new { path = context.Request.Path });
                }

                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                await context.Response.WriteAsync("An error occurred while processing your request.");
            }
        }

    }
}

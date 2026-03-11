using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ResourceShared.Logger;
using ResourceShared.Models;
using ResourceShared.Utils;
using System;
using System.Security.Claims;

namespace ResourceShared.Middlewares;

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

    public async Task InvokeAsync(HttpContext context, AppDbContext db, RedisHelper redis)
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

                    var teamIdStr = context.User.FindFirstValue("teamId");
                    if (string.IsNullOrEmpty(teamIdStr) || !int.TryParse(teamIdStr, out var claimTeamId))
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("Invalid user token.");
                        return;
                    }

                    // Try read from Redis cache first
                    var cacheKey = $"auth:user:{id}";
                    AuthInfoCacheDTO? authInfoCache = null;
                    try
                    {
                        authInfoCache = await redis.GetFromCacheAsync<AuthInfoCacheDTO>(cacheKey);
                    }
                    catch
                    {
                        // ignore cache errors and fallback to DB
                    }

                    if (authInfoCache != null)
                    {
                        var tokenUuidFromClaim = context.User.FindFirstValue("tokenUuid");
                        if (string.IsNullOrEmpty(authInfoCache.TokenValueFromDb)
                            || !authInfoCache.TokenValueFromDb.Equals(tokenUuidFromClaim))
                        {
                            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                            await context.Response.WriteAsync("Invalid user token");
                            return;
                        }

                        if (authInfoCache.TeamId != claimTeamId)
                        {
                            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                            await context.Response.WriteAsync("Invalid user token.");
                            return;
                        }

                        if (authInfoCache.Banned == true)
                        {
                            context.Response.StatusCode = StatusCodes.Status403Forbidden;
                            await context.Response.WriteAsync("Account banned.");
                            return;
                        }

                        if (authInfoCache.Hidden == true)
                        {
                            context.Response.StatusCode = StatusCodes.Status403Forbidden;
                            await context.Response.WriteAsync("Account hidden.");
                            return;
                        }

                        if (authInfoCache.TeamBanned == true)
                        {
                            context.Response.StatusCode = StatusCodes.Status403Forbidden;
                            await context.Response.WriteAsync("Your team has been banned.");
                            return;
                        }

                        await _next(context);
                        return;
                    }

                    // Cache miss: read from DB and populate cache
                    var authInfo = await db.Users
                        .AsNoTracking()
                        .Where(u => u.Id == id)
                        .Select(u => new
                        {
                            u.Banned,
                            u.Hidden,
                            u.TeamId,
                            TeamBanned = u.Team != null ? u.Team.Banned : (bool?)null,
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

                    var tokenUuidFromClaim2 = context.User.FindFirstValue("tokenUuid");
                    if (string.IsNullOrEmpty(authInfo.TokenValueFromDb) || !authInfo.TokenValueFromDb.Equals(tokenUuidFromClaim2))
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("Invalid user token");
                        return;
                    }

                    if (authInfo.TeamId != claimTeamId)
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("Invalid user token.");
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

                    if (authInfo.TeamBanned == true)
                    {
                        context.Response.StatusCode = StatusCodes.Status403Forbidden;
                        await context.Response.WriteAsync("Your team has been banned.");
                        return;
                    }

                    // Populate cache (short TTL)
                    try
                    {
                        var dto = new AuthInfoCacheDTO
                        {
                            TokenValueFromDb = authInfo.TokenValueFromDb,
                            TeamId = authInfo.TeamId,
                            Banned = authInfo.Banned,
                            Hidden = authInfo.Hidden,
                            TeamBanned = authInfo.TeamBanned
                        };
                        var ttlSeconds = 60;
                        _ = await redis.SetCacheAsync(cacheKey, dto, TimeSpan.FromSeconds(ttlSeconds));
                    }
                    catch
                    {
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

    private class AuthInfoCacheDTO
    {
        public string? TokenValueFromDb { get; set; }
        public int? TeamId { get; set; }
        public bool? Banned { get; set; }
        public bool? Hidden { get; set; }
        public bool? TeamBanned { get; set; }
    }
}


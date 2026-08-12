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

                var tokenUuidFromClaim = context.User.FindFirstValue("tokenUuid");
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

                // Cache chi duoc tin khi CO gia tri VA tokenUuid khop. Neu cache co gia
                // tri nhung LECH voi JWT, KHONG duoc tu choi ngay - cache co the la ban
                // ghi cu con sot lai do RemoveCacheAsync/SetCacheAsync bi loi am tham
                // duoi tai cao (xem RedisHelper). Phai fallback xuong DB - nguon du lieu
                // dung - truoc khi ket luan token co that su khong hop le hay khong.
                var cacheIsAuthoritative = authInfoCache != null
                    && !string.IsNullOrEmpty(authInfoCache.TokenValueFromDb)
                    && authInfoCache.TokenValueFromDb.Equals(tokenUuidFromClaim);

                AuthInfoCacheDTO authInfo;
                if (cacheIsAuthoritative)
                {
                    authInfo = authInfoCache!;
                }
                else
                {
                    var dbInfo = await db.Users
                        .AsNoTracking()
                        .Where(u => u.Id == id)
                        .Select(u => new
                        {
                            u.Verified,
                            u.Banned,
                            u.Hidden,
                            // TeamBanned: user is banned if ANY of their teams is banned
                            TeamBanned = db.UserTeamMembers
                                .Where(m => m.UserId == u.Id)
                                .Any(m => m.Team.Banned == true),
                            // OrderByDescending(Id): neu co nhieu dong token cho cung 1
                            // user (du lieu cu con sot lai), luon lay dong MOI NHAT thay
                            // vi mot dong bat ky - FirstOrDefault khong co order la nguon
                            // goc that su cua bug "Invalid user token" khong nhat quan.
                            TokenValueFromDb = db.Tokens
                                .Where(t => t.UserId == id && t.Type == Enums.UserType.User)
                                .OrderByDescending(t => t.Id)
                                .Select(t => t.Value)
                                .FirstOrDefault()
                        })
                        .FirstOrDefaultAsync();

                    if (dbInfo == null)
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("User not found.");
                        return;
                    }

                    if (string.IsNullOrEmpty(dbInfo.TokenValueFromDb) || !dbInfo.TokenValueFromDb.Equals(tokenUuidFromClaim))
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        await context.Response.WriteAsync("Invalid user token");
                        return;
                    }

                    authInfo = new AuthInfoCacheDTO
                    {
                        TokenValueFromDb = dbInfo.TokenValueFromDb,
                        Verified = dbInfo.Verified,
                        Banned = dbInfo.Banned,
                        Hidden = dbInfo.Hidden,
                        TeamBanned = dbInfo.TeamBanned
                    };

                    // DB la nguon dung - ghi de lai cache ngay (tu chua lanh, khong can
                    // cho ban ghi cu tu het han TTL).
                    try
                    {
                        var ttlSeconds = 60;
                        _ = await redis.SetCacheAsync(cacheKey, authInfo, TimeSpan.FromSeconds(ttlSeconds));
                    }
                    catch
                    {
                    }
                }

                if (authInfo.Verified != true)
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await context.Response.WriteAsync("Account not verified.");
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
        public bool? Verified { get; set; }
        public bool? Banned { get; set; }
        public bool? Hidden { get; set; }
        public bool? TeamBanned { get; set; }
    }
}


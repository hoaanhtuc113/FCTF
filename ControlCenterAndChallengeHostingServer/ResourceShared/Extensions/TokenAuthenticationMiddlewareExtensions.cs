using Microsoft.AspNetCore.Builder;
using ResourceShared.Middlewares;

namespace ResourceShared.Extensions
{
    public static class TokenAuthenticationMiddlewareExtensions
    {
        public static IApplicationBuilder UseTokenAuthentication(this IApplicationBuilder app)
        {
            app.UseMiddleware<TokenAuthenticationMiddleware>();
            return app;
        }
    }
}

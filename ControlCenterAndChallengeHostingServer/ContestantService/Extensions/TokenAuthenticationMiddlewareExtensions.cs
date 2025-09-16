using ContestantService.Middlewares;

namespace ContestantService.Extensions
{
    public static class TokenAuthenticationMiddlewareExtensions
    {
        public static WebApplication UseTokenAuthentication(this WebApplication app)
        {
            app.UseMiddleware<TokenAuthenticationMiddleware>();
            return app;
        }
    }
}

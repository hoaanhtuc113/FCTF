using Microsoft.AspNetCore.Http;
using ResourceShared.Models;

namespace ResourceShared.Extensions
{
    public static class HttpContextExtensions
    {
        public static User GetCurrentUser(this HttpContext context)
        {
            return context.Items["CurrentUser"] as User;
        }
    }
}

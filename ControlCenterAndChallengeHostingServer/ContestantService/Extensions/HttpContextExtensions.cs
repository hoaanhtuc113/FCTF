using ResourceShared.Models;

namespace ContestantService.Extensions
{
    public static class HttpContextExtensions
    {
        public static User GetCurrentUser(this HttpContext context)
        {
            return context.Items["CurrentUser"] as User;
        }
    }
}

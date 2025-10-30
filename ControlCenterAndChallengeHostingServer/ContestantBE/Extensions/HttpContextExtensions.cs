using ResourceShared.Models;

namespace ContestantBE.Extensions
{
    public static class HttpContextExtensions
    {
        public static User GetCurrentUser(this HttpContext context)
        {
            return context.Items["CurrentUser"] as User;
        }
    }
}

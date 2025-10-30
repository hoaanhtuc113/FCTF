using System;

namespace ContestantBE.Attribute
{
    /// <summary>
    /// Attribute đánh dấu endpoint cần authentication.
    /// Chỉ các endpoint có attribute này mới được áp dụng TokenAuthenticationMiddleware.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false)]
    public class RequireAuthAttribute : System.Attribute
    {
    }
}

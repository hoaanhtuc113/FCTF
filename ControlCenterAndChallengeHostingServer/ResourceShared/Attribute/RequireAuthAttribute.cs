using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.Attribute
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

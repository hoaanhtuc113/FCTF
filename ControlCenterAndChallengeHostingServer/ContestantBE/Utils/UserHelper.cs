using Microsoft.Extensions.Options;
using ResourceShared.Utils;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using static System.Net.Mime.MediaTypeNames;

namespace ContestantBE.Utils
{
    public class UserHelper : CommonUserHelper
    {
        public UserHelper(IOptions<ProxyOptions> options) : base(options)
        {
        }

        public string GetIP(HttpContext context)
        {
            var combined = "(" + string.Join(")|(", _trustedProxies) + ")";

            var route = context.Request.Headers["X-Forwarded-For"]
                .ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(ip => ip.Trim())
                .ToList();

            var remoteAddr = context.Connection.RemoteIpAddress?.ToString();
            if (!string.IsNullOrEmpty(remoteAddr))
            {
                route.Add(remoteAddr);
            }

            bool found = false;
            foreach (var addr in route.AsEnumerable().Reverse())
            {
                if (!Regex.IsMatch(addr, combined,RegexOptions.None,TimeSpan.FromMilliseconds(100)))
                {
                    remoteAddr = addr;
                    found = true;
                    break;
                }
            }

            if (!found)
            {
                remoteAddr = context.Connection.RemoteIpAddress?.ToString();
            }

            // Remove IPv6 prefix ::ffff: if present (IPv4-mapped IPv6 address)
            if (!string.IsNullOrEmpty(remoteAddr) && remoteAddr.StartsWith("::ffff:"))
            {
                remoteAddr = remoteAddr.Substring(7);
            }

            return remoteAddr ?? "unknown";
        }
    }
}

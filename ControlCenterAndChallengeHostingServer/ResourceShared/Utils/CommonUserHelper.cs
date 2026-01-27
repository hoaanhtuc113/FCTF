using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace ResourceShared.Utils
{
    public class ProxyOptions
    {
        public string[] TrustedProxies { get; set; } = [];
    }
    public class CommonUserHelper
    {

        public readonly string[] _trustedProxies;

        public CommonUserHelper(IOptions<ProxyOptions> options)
        {
            _trustedProxies = options.Value.TrustedProxies;
        }
    }
}

using Microsoft.Extensions.Options;

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

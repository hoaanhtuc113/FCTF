using Microsoft.Extensions.DependencyInjection;
using ResourceShared.Services;
using ResourceShared.Utils;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared
{
    public static class ServiceCollectionExtensions
    {
        public static IServiceCollection AddResourceShared(this IServiceCollection services)
        {
            services.AddScoped<IK8sHealthService, K8sHealthService>();
            return services;
        }
    }
}

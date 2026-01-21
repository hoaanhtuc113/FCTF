using DeploymentConsumer.Models;
using System;
using System.Collections.Generic;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace DeploymentConsumer.Services
{
    public interface IArgoWorkflowService
    {
        Task<int> GetRunningWorkflowsCountAsync(CancellationToken ct);
    }
    public class ArgoWorkflowService : IArgoWorkflowService
    {
        private readonly HttpClient _httpClient;

        public ArgoWorkflowService(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        public async Task<int> GetRunningWorkflowsCountAsync(CancellationToken ct)
        {
            try
            {
                var url = $"{DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_URL}/workflows/argo?listOptions.fieldSelector=status.phase=Running";

                _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_TOKEN);

                var response = await _httpClient.GetAsync(url, ct);
                response.EnsureSuccessStatusCode();

                var json = await response.Content.ReadAsStringAsync(ct);
                var data = JsonSerializer.Deserialize<ArgoWorkflowsResponse>(json);

                int count = data?.Items?.Count ?? 0;

                return count;
            }
            catch (Exception ex)
            {
                return 30; // return maximum when error to stop
            }
        }
    }
}

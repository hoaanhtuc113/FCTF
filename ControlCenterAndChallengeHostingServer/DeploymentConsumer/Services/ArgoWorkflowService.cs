using DeploymentConsumer.Models;
using System.Net.Http.Headers;
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
                using var request = new HttpRequestMessage(HttpMethod.Get, DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_URL);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", DeploymentConsumerConfigHelper.ARGO_WORKFLOWS_TOKEN);

                var response = await _httpClient.SendAsync(request, ct);
                if (!response.IsSuccessStatusCode)
                {
                    var errorBody = await response.Content.ReadAsStringAsync(ct);
                    Console.WriteLine($"[Argo Error Detail]: {errorBody}");
                    return 30;
                }

                var json = await response.Content.ReadAsStringAsync(ct);

                var data = JsonSerializer.Deserialize<ArgoWorkflowsResponse>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                int count = data?.Items?.Count(x =>
                    x.Status != null &&
                    x.Status.Phase?.Equals("Running", StringComparison.OrdinalIgnoreCase) == true
                ) ?? 0;

                return count;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Argo Service] Exception: {ex.Message}");
                return 30;
            }
        }
    }
}

using ResourceShared.Utils;
using RestSharp;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace ResourceShared.Services
{
    public interface IArgoWorkFlowService
    {
        Task<string?> GetWorkflowStatusAsync(string url, string wfName);
    }
    public class ArgoWorkFlowService : IArgoWorkFlowService
    {
        public async Task<string?> GetWorkflowStatusAsync(string url, string wfName)
        {
            try
            {
                var api = $"{url}/{wfName}";

                MultiServiceConnector connector = new MultiServiceConnector(api);
                var headers = new Dictionary<string, string>
                                                            {
                                                                { "Content-Type", "application/json" },
                                                                { "Accept", "application/json" }
                                                            };

                var respContent = await connector.ExecuteRequest(api, Method.Get, new { }, headers);
                if (string.IsNullOrEmpty(respContent))
                    return null;

                using var json = JsonDocument.Parse(respContent);
                if (json.RootElement.TryGetProperty("status", out var statusElem) &&
                    statusElem.TryGetProperty("phase", out var phaseElem))
                {
                    return phaseElem.GetString(); // e.g. "Running", "Succeeded", "Failed"
                }

                return null;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"GetWorkflowStatus error: {ex.Message}");
                return null;
            }
        }
    }
}

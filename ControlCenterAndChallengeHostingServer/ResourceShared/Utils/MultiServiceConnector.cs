using Newtonsoft.Json;
using OpenTelemetry;
using OpenTelemetry.Context.Propagation;
using OpenTelemetry.Trace;
using RestSharp;
using System.Diagnostics;

namespace ResourceShared.Utils
{
    public class MultiServiceConnector
    {
        public MultiServiceConnector()
        {
        }
        private static RestClient CreateClient(string baseUrl)
        {
            return new RestClient(new RestClientOptions(baseUrl)
            {
                CookieContainer = new(),
                Timeout = TimeSpan.FromMinutes(5)
            });
        }

        public async Task<string?> ExecuteNormalRequest(
            string baseUrl,
            string apiPath,
            Method method,
            Dictionary<string, object> parameters,
            RequestContentType contentType,
            Dictionary<string, string>? headers = null)
        {
            var request = new RestRequest
            {
                Method = method,
                Resource = apiPath
            };
            if (headers != null)
            {
                foreach (var header in headers)
                {
                    request.AddHeader(header.Key, header.Value);
                }
            }
            switch (contentType)
            {
                case RequestContentType.Json:
                    request.RequestFormat = DataFormat.Json;
                    request.AddJsonBody(parameters);
                    break;
                case RequestContentType.Form:
                    foreach (var data in parameters)
                    {
                        request.AddParameter(data.Key, data.Value.ToString());
                    }
                    break;
                case RequestContentType.Query:
                    foreach (var data in parameters)
                    {
                        request.AddQueryParameter(data.Key, data.Value.ToString());
                    }
                    break;
                default:
                    break;
            }
            var response = await CreateClient(baseUrl).ExecuteAsync(request);

            if (!response.IsSuccessful && string.IsNullOrEmpty(response.Content))
            {
                throw new Exception("Failed to execute request");
            }

            try
            {
                return response.Content;
            }
            catch (Exception ex)
            {
                throw new Exception($"Deserialize failed, error: {ex.Message}. string {ex}", ex);
            }
        }
        public async Task<T?> ExecuteRequest<T>(
            string baseUrl,
            string apiPath,
            Method method,
            Dictionary<string, object> parameters,
            RequestContentType contentType)
        {
            var request = new RestRequest
            {
                Method = method,
                Resource = apiPath
            };
            switch (contentType)
            {
                case RequestContentType.Json:
                    request.RequestFormat = DataFormat.Json;
                    request.AddJsonBody(parameters);
                    break;
                case RequestContentType.Form:
                    foreach (var data in parameters)
                    {
                        request.AddParameter(data.Key, data.Value.ToString());
                    }
                    break;
                case RequestContentType.Query:
                    foreach (var data in parameters)
                    {
                        request.AddQueryParameter(data.Key, data.Value.ToString());
                    }
                    break;
                default:
                    break;
            }
            var response = await CreateClient(baseUrl).ExecuteAsync(request);

            if (!response.IsSuccessful || string.IsNullOrEmpty(response.Content))
            {
                throw new Exception("Failed to execute request");
            }

            T? result;
            try
            {
                result = JsonConvert.DeserializeObject<T>(response.Content);
                return result;
            }
            catch (Exception ex)
            {
                throw new Exception($"Deserialize failed, error: {ex.Message}. string {ex}", ex);
            }
        }
        public async Task<T?> ExecuteRequest<T>(
            string baseUrl,
            RestRequest request,
            Dictionary<string, object> parameters,
            RequestContentType contentType)
        {
            switch (contentType)
            {
                case RequestContentType.Json:
                    request.RequestFormat = DataFormat.Json;
                    request.AddJsonBody(parameters);
                    break;
                case RequestContentType.Form:
                    foreach (var data in parameters)
                    {
                        request.AddParameter(data.Key, data.Value.ToString());
                    }
                    break;
                case RequestContentType.Query:
                    foreach (var data in parameters)
                    {
                        request.AddQueryParameter(data.Key, data.Value.ToString());
                    }
                    break;
                default:
                    break;
            }
            var response = await CreateClient(baseUrl).ExecuteAsync(request);

            if (!response.IsSuccessful || string.IsNullOrEmpty(response.Content))
            {
                throw new Exception($"Request failed, status code: {response.StatusCode}. response: {response.Content}", new($"Request failed, status code: {response.StatusCode}. response: {response.Content}"));
            }

            T? result = default;
            try
            {
                result = JsonConvert.DeserializeObject<T>(response.Content);
            }
            catch (Exception ex)
            {
                throw new Exception($"Request failed, ex.Message: {ex.Message}. string {ex}", new($"Request failed, status code: {ex.Message}. string {ex}"));
            }
            return result;
        }
        public async Task<string?> ExecuteRequest(
            string baseUrl,
            string apiPath,
            Method method,
            object body,
            Dictionary<string, string>? headers = null)
        {
            var request = new RestRequest(apiPath, method)
                .AddHeader("Content-Type", "application/json")
                .AddJsonBody(body);

            if (headers != null)
                foreach (var h in headers)
                    request.AddHeader(h.Key, h.Value);

            var response = await CreateClient(baseUrl).ExecuteAsync(request);
            if (!response.IsSuccessful)
                throw new Exception($"[{(int)response.StatusCode}] {response.StatusDescription}\n{response.Content}");

            return response.Content;
        }
    }
    public enum RequestContentType
    {
        Json,
        Form,
        Query
    }
}

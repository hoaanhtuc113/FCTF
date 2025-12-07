using Newtonsoft.Json;
using RestSharp;

namespace ResourceShared.Utils
{
    public class MultiServiceConnector
    {
        private RestClient client { get; set; }
        public MultiServiceConnector(string BaseUrl)
        {
            RestClientOptions options = new RestClientOptions(BaseUrl);
            options.CookieContainer = new();
            options.Timeout = TimeSpan.FromMinutes(15);
            client = new RestClient(options);
        }
        public async Task<string?> ExecuteNormalRequest(string ApiPath, Method method, Dictionary<string, object> parameters, RequestContentType contentType, Dictionary<string, string>? headers = null)
        {
            var request = new RestRequest();
            request.Method = method;
            request.Resource = ApiPath;
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
            var response = await client.ExecuteAsync(request);
            if (response.StatusCode != System.Net.HttpStatusCode.OK && string.IsNullOrEmpty(response.Content))
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
        public async Task<T?> ExecuteRequest<T>(string ApiPath, Method method, Dictionary<string, object> parameters, RequestContentType contentType)
        {
            var request = new RestRequest();
            request.Method = method;
            request.Resource = ApiPath;
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
            var response = await client.ExecuteAsync(request);
            if (response.StatusCode != System.Net.HttpStatusCode.OK || string.IsNullOrEmpty(response.Content) || !IsValidJson(response.Content))
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
        public async Task<T?> ExecuteRequest<T>(RestRequest request, Dictionary<string, object> parameters, RequestContentType contentType)
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
            var response = await client.ExecuteAsync(request);
            if (response.StatusCode != System.Net.HttpStatusCode.OK || string.IsNullOrEmpty(response.Content) || !IsValidJson(response.Content))
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
        public async Task<string?> ExecuteRequest( string apiPath, Method method, object body,Dictionary<string, string>? headers = null)
        {
            var request = new RestRequest(apiPath, method)
                .AddHeader("Content-Type", "application/json")
                .AddJsonBody(body);

            if (headers != null)
                foreach (var h in headers)
                    request.AddHeader(h.Key, h.Value);

            var resp = await client.ExecuteAsync(request);
            if (!resp.IsSuccessful)
                throw new Exception($"[{(int)resp.StatusCode}] {resp.StatusDescription}\n{resp.Content}");

            return resp.Content;
        }

        //function to check if a string is a valid json
        public bool IsValidJson(string strInput)
        {
            strInput = strInput.Trim();
            if ((strInput.StartsWith("{") && strInput.EndsWith("}")) || //For object
                (strInput.StartsWith("[") && strInput.EndsWith("]"))) //For array
            {
                try
                {
                    var obj = Newtonsoft.Json.Linq.JToken.Parse(strInput);
                    return true;
                }
                catch (Newtonsoft.Json.JsonReaderException)
                {
                    return false;
                }
                catch (Exception)
                {
                    return false;
                }
            }
            else
            {
                return false;
            }
        }
    }
    public enum RequestContentType
    {
        Json,
        Form,
        Query
    }
}

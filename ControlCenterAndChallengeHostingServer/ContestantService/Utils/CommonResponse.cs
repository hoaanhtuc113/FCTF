using System.Net;

namespace ContestantService.Utils
{
    public class CommonResponse<T>
    {
        public HttpStatusCode HttpStatusCode{ get; set; }
        public T? data { get; set; }
        public string? message { get; set; }
    }
}

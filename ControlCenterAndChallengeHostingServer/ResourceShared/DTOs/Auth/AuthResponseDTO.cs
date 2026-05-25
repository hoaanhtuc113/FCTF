
using System.Text.Json.Serialization;

namespace ResourceShared.DTOs.Auth
{
    public class AuthResponseDTO
    {
        public int id { get; set; }
        public string username { get; set; } = string.Empty;
        public string email { get; set; } = string.Empty;
        [JsonIgnore]
        public string token { get; set; } = string.Empty;
    }

    /// <summary>
    /// JWT payload — contains only user identity.
    /// Team resolution is done per-request using contestId from the route.
    /// </summary>
    public class AuthInfo
    {
        public int userId { get; set; }
    }
}

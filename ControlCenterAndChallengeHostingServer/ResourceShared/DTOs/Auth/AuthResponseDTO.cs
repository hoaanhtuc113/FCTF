
using System.Text.Json.Serialization;

namespace ResourceShared.DTOs.Auth
{
    public class AuthResponseDTO
    {
        public int id { get; set; }
        public string username { get; set; } = string.Empty;
        public string email { get; set; } = string.Empty;
        public TeamResponse? team { get; set; }
        [JsonIgnore]
        public string token { get; set; } = string.Empty;

    }
    public class TeamResponse
    {
        public int id { get; set; }
        public string teamName { get; set; } = string.Empty;
    }
}

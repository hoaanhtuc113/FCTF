using System.Collections.Generic;
using System.Text.Json;

namespace ResourceShared.DTOs.Auth
{
    public class RegisterContestantDTO
    {
        public string username { get; set; } = string.Empty;
        public string email { get; set; } = string.Empty;
        public string password { get; set; } = string.Empty;
        public string confirmPassword { get; set; } = string.Empty;
        public string? captchaToken { get; set; }
        public List<RegistrationFieldValueDTO> userFields { get; set; } = new();
    }

    public class RegistrationFieldValueDTO
    {
        public int fieldId { get; set; }
        public JsonElement? value { get; set; }
    }

    public class RegistrationMetadataDTO
    {
        public List<RegistrationFieldDefinitionDTO> userFields { get; set; } = new();
        public RegistrationConstraintsDTO constraints { get; set; } = new();
    }

    public class RegistrationFieldDefinitionDTO
    {
        public int id { get; set; }
        public string name { get; set; } = string.Empty;
        public string fieldType { get; set; } = "text";
        public string? description { get; set; }
        public bool required { get; set; }
    }

    public class RegistrationConstraintsDTO
    {
        public int numUsersLimit { get; set; }
    }
}

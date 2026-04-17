using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace ResourceShared.DTOs.Auth
{
    [AttributeUsage(AttributeTargets.Property | AttributeTargets.Field, AllowMultiple = false)]
    public sealed class JsonElementMaxLengthAttribute : ValidationAttribute
    {
        public int MaxLength { get; }

        public JsonElementMaxLengthAttribute(int maxLength)
        {
            MaxLength = maxLength;
            ErrorMessage = $"The field exceeds the maximum allowed length of {maxLength} characters.";
        }

        protected override ValidationResult? IsValid(object? value, ValidationContext validationContext)
        {
            if (value == null)
            {
                return ValidationResult.Success;
            }

            if (value is JsonElement jsonElement)
            {
                var length = jsonElement.ValueKind == JsonValueKind.String
                    ? (jsonElement.GetString()?.Length ?? 0)
                    : jsonElement.GetRawText().Length;

                if (length > MaxLength)
                {
                    return new ValidationResult($"{validationContext.DisplayName} must not exceed {MaxLength} characters.");
                }
            }

            return ValidationResult.Success;
        }
    }

    public class RegisterContestantDTO
    {
        [Required,MaxLength(255)]
        public string username { get; set; } = string.Empty;
        [Required,EmailAddress,MaxLength(255)]
        public string email { get; set; } = string.Empty;
        [Required,MaxLength(255)]
        public string password { get; set; } = string.Empty;
        [Required,MaxLength(255)]
        public string confirmPassword { get; set; } = string.Empty;
        [Required,MaxLength(10000)]
        public string? captchaToken { get; set; }
        public List<RegistrationFieldValueDTO> userFields { get; set; } = new();
    }

    public class RegistrationFieldValueDTO
    {
        public int fieldId { get; set; }
        [JsonElementMaxLength(255)]
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

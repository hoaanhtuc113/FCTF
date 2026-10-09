using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace ResourceShared.DTOs.ActionLogs
{
    public class ActionLogsReq
    {
        [Required(ErrorMessage = "ActionType is required")]
        [Range(1, 7, ErrorMessage = "Unknown action type")]
        [JsonPropertyName("actionType")]
        public int ActionType { get; set; }

        [Required(ErrorMessage = "ActionDetail is required")]
        [StringLength(255, MinimumLength = 1, ErrorMessage = "ActionDetail must be between 1 and 255 characters")]
        [JsonPropertyName("actionDetail")]
        public string ActionDetail { get; set; } = string.Empty;

        [JsonPropertyName("challenge_id")]
        public int? ChallengeId { get; set; }
    }
}

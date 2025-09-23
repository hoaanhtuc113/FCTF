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
        [Range(0, int.MaxValue, ErrorMessage = "ActionType must be greater or equal to 0")]
        [JsonPropertyName("actionType")]
        public int ActionType { get; set; }

        [Required(ErrorMessage = "ActionDetail is required")]
        [StringLength(500, MinimumLength = 1, ErrorMessage = "ActionDetail must be between 1 and 500 characters")]
        [JsonPropertyName("actionDetail")]
        public string ActionDetail { get; set; } = string.Empty;

        [Required(ErrorMessage = "ChallengeId is required")]
        [Range(1, int.MaxValue, ErrorMessage = "ChallengeId must be greater than 0")]
        [JsonPropertyName("challenge_id")]
        public int ChallengeId { get; set; }
    }
}

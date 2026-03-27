using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Text.Json.Serialization;
using ResourceShared.Utils.JsonConverters;

namespace ResourceShared.DTOs.Challenge
{
    public class ChallengeImageDTO
    {
        public string? imageLink { get; set; }

        [JsonConverter(typeof(NumberOrStringToStringConverter))]
        public string? exposedPort { get; set; }
    }
}

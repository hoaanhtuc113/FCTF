using System;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ResourceShared.Utils.JsonConverters
{
    public class NumberOrStringToStringConverter : JsonConverter<string?>
    {
        public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            return reader.TokenType switch
            {
                JsonTokenType.String => reader.GetString(),
                JsonTokenType.Number => reader.TryGetInt64(out var l)
                    ? l.ToString()
                    : reader.GetDouble().ToString(),
                JsonTokenType.Null => null,
                _ => throw new JsonException($"Unexpected token parsing string: {reader.TokenType}")
            };
        }

        public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options)
        {
            if (value is null)
            {
                writer.WriteNullValue();
                return;
            }

            if (long.TryParse(value, out var l))
            {
                writer.WriteNumberValue(l);
            }
            else
            {
                writer.WriteStringValue(value);
            }
        }
    }
}

namespace ResourceShared.Utils;

public static class InputValidation
{
    public static bool IsPlainName(string? value, int maxLength = 128) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= maxLength
        && !value.Any(c => c is '<' or '>' || char.IsControl(c));
}

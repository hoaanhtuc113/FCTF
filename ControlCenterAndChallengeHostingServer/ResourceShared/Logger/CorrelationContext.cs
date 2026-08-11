using System.Text.RegularExpressions;

namespace ResourceShared.Logger;

/// <summary>
/// The id that ties one deploy request together across the services it passes
/// through. It rides an AsyncLocal rather than a parameter because AppLogger is
/// called from a hundred places that would otherwise all have to pass it along,
/// and a correlation id only helps if it is on every line, not the ones someone
/// remembered to thread it through.
/// </summary>
public static class CorrelationContext
{
    private static readonly AsyncLocal<string?> _current = new();

    // Ids arrive over an HTTP header and end up in log lines and Kubernetes
    // labels, so what they may contain is worth being narrow about: a newline
    // would let a caller write its own log entries, and a label rejects most of
    // what a string can hold anyway. The 63 character ceiling is the label value
    // limit, so anything accepted here is usable as one without further checking.
    private static readonly Regex Allowed = new("^[A-Za-z0-9-]{1,63}$", RegexOptions.Compiled);

    public static string? Current
    {
        get => _current.Value;
        set => _current.Value = value;
    }

    public static string New() => Guid.NewGuid().ToString("N");

    /// <summary>
    /// Returns the caller's id when it is one we are willing to repeat back, and
    /// a fresh one otherwise. A rejected id is not an error worth failing the
    /// request over - it only means this hop starts a new chain.
    /// </summary>
    public static string Accept(string? incoming)
        => !string.IsNullOrWhiteSpace(incoming) && Allowed.IsMatch(incoming) ? incoming : New();
}

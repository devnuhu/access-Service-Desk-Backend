using System.Text.RegularExpressions;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// The short piece of a comment that goes into its notification (and so into the email): one line, at most 300 characters,
    /// with any RSA PIN masked the same way the duplicate check shows it. Returns the ending of the sentence: ': "text".' or just '.'.
    /// </summary>
    public static class CommentExcerpt
    {
        public const int MaxLength = 300;

        private static readonly Regex Spaces = new(@"\s+", RegexOptions.Compiled);
        private static readonly Regex Pin = new(@"\bPEN\d{12}\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public static string For(string? commentText)
        {
            var flat = Spaces.Replace(commentText ?? string.Empty, " ").Trim();
            if (flat.Length == 0) return ".";
            flat = Pin.Replace(flat, m => "PEN********" + m.Value.Substring(m.Value.Length - 4));
            if (flat.Length > MaxLength) flat = flat.Substring(0, MaxLength).TrimEnd() + "...";
            return ": \"" + flat + "\".";
        }
    }
}
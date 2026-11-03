using System.Text;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;
using Ganss.Xss;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// Cleans HTML from the rich-text editor (TipTap) before it is stored, and makes the plain-text copy used for search and the
    /// duplicate check. Allowlist only: formatting, lists, headings, links (http, https, mailto), code and tables, with colour,
    /// highlight, alignment and column widths. Everything else (scripts, event handlers, images, iframes, forms, data: links,
    /// other styles) is removed; the text inside removed formatting tags is kept. The web app shows this HTML, so this is what
    /// stops one ticket from attacking everyone who opens it.
    /// </summary>
    public static class RichText
    {
        private static readonly string[] Tags =
        {
            "p", "br", "hr", "div", "span", "strong", "b", "em", "i", "u", "s", "strike", "del", "sub", "sup", "mark",
            "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "pre", "code", "a",
            "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col", "caption"
        };
        private static readonly string[] Attributes = { "href", "style", "colspan", "rowspan", "colwidth", "start" };
        private static readonly string[] CssProperties = { "color", "background-color", "text-align", "width", "min-width" };
        private static readonly string[] Schemes = { "http", "https", "mailto" };
        private static readonly HashSet<string> BlockTags = new(StringComparer.OrdinalIgnoreCase)
        {
            "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "blockquote", "pre", "table", "caption", "hr"
        };
        private static readonly Regex BlankLines = new(@"\n{3,}", RegexOptions.Compiled);
        private static readonly Regex Spaces = new(@"[ \t\u00A0]+", RegexOptions.Compiled);

        /// <summary>Returns cleaned HTML (empty when there is nothing left).</summary>
        public static string Clean(string? html)
        {
            if (string.IsNullOrWhiteSpace(html)) return string.Empty;
            var sanitizer = new HtmlSanitizer();
            sanitizer.AllowedTags.Clear();
            foreach (var tag in Tags) sanitizer.AllowedTags.Add(tag);
            sanitizer.AllowedAttributes.Clear();
            foreach (var attribute in Attributes) sanitizer.AllowedAttributes.Add(attribute);
            sanitizer.AllowedCssProperties.Clear();
            foreach (var property in CssProperties) sanitizer.AllowedCssProperties.Add(property);
            sanitizer.AllowedSchemes.Clear();
            foreach (var scheme in Schemes) sanitizer.AllowedSchemes.Add(scheme);
            sanitizer.AllowedAtRules.Clear();
            sanitizer.AllowDataAttributes = false;
            sanitizer.KeepChildNodes = true;
            sanitizer.PostProcessNode += (_, e) =>
            {
                // Links open in a new tab and never pass the page or a referrer to the other site
                if (e.Node is IElement element && string.Equals(element.LocalName, "a", StringComparison.OrdinalIgnoreCase))
                {
                    element.SetAttribute("target", "_blank");
                    element.SetAttribute("rel", "noopener noreferrer nofollow");
                }
            };
            return sanitizer.Sanitize(html).Trim();
        }

        /// <summary>Plain text of cleaned HTML: paragraphs and rows on their own lines, table cells separated by tabs.</summary>
        public static string ToText(string cleanHtml)
        {
            if (string.IsNullOrWhiteSpace(cleanHtml)) return string.Empty;
            var document = new HtmlParser().ParseDocument("<!doctype html><html><body>" + cleanHtml + "</body></html>");
            var text = new StringBuilder();
            if (document.Body != null) Walk(document.Body, text);
            var lines = text.ToString().Replace("\r", string.Empty).Split('\n').Select(l => Spaces.Replace(l, " ").Trim());
            return BlankLines.Replace(string.Join("\n", lines), "\n\n").Trim();
        }

        private static void Walk(INode node, StringBuilder text)
        {
            foreach (var child in node.ChildNodes)
            {
                if (child is IText t)
                {
                    text.Append(t.Data);
                }
                else if (child is IElement element)
                {
                    var tag = element.LocalName;
                    if (tag == "br") { text.Append('\n'); continue; }
                    Walk(element, text);
                    if (tag is "td" or "th") text.Append('\t');
                    else if (BlockTags.Contains(tag)) text.Append('\n');
                }
            }
        }
    }
}
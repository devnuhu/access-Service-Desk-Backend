using ServiceDeskAPI.Infrastructure.Tickets;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>The rich-text cleaner: what the editor needs survives, anything that could run code does not.</summary>
    public class RichTextTests
    {
        [Fact]
        public void Formatting_lists_links_and_tables_survive()
        {
            var html = RichText.Clean(
                "<h2>Request</h2><p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s> <mark>hi</mark> <span style=\"color: #ff0000\">red</span></p>" +
                "<ul><li>one</li></ul><ol start=\"3\"><li>three</li></ol><p style=\"text-align: center\"><a href=\"https://www.accessarmpensions.com\">site</a></p>" +
                "<table><colgroup><col style=\"width: 120px\"></colgroup><tbody><tr><th colspan=\"2\">Head</th></tr><tr><td>A1</td><td>B1</td></tr></tbody></table>");

            Assert.Contains("<h2>Request</h2>", html);
            Assert.Contains("<strong>Bold</strong>", html);
            Assert.Contains("<mark>hi</mark>", html);
            Assert.Contains("color: rgba(255, 0, 0, 1)", html.Replace("#ff0000", "rgba(255, 0, 0, 1)"));
            Assert.Contains("<ol start=\"3\">", html);
            Assert.Contains("text-align: center", html);
            Assert.Contains("href=\"https://www.accessarmpensions.com\"", html);
            Assert.Contains("rel=\"noopener noreferrer nofollow\"", html);
            Assert.Contains("<th colspan=\"2\">Head</th>", html);
            Assert.Contains("<td>A1</td>", html);
        }

        [Fact]
        public void Scripts_handlers_images_and_dangerous_links_are_removed()
        {
            var html = RichText.Clean(
                "<p onclick=\"alert(1)\">Hi<script>alert(2)</script></p><img src=\"x\" onerror=\"alert(3)\">" +
                "<a href=\"javascript:alert(4)\">bad</a><a href=\"data:text/html;base64,PHNjcmlwdD4=\">data</a>" +
                "<iframe src=\"https://evil.example\"></iframe><form><input value=\"x\"></form>" +
                "<p style=\"position: fixed; background-image: url(https://evil.example/x.png); color: blue\">styled</p>");

            Assert.DoesNotContain("script", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("onclick", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("onerror", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("<img", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("javascript:", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("data:", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("iframe", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("<input", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("position", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("url(", html, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("Hi", html);
            Assert.Contains("styled", html);
        }

        [Fact]
        public void Plain_text_keeps_lines_and_table_cells()
        {
            var text = RichText.ToText(RichText.Clean("<p>First line</p><p>Second<br>line</p><table><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>"));

            Assert.Equal("First line\nSecond\nline\nA1 B1\nA2 B2", text);
        }

        [Fact]
        public void Empty_editor_output_has_no_text()
        {
            Assert.Equal(string.Empty, RichText.ToText(RichText.Clean("<p></p><p> </p><p><br></p>")));
            Assert.Equal(string.Empty, RichText.Clean(null));
        }
    }
}
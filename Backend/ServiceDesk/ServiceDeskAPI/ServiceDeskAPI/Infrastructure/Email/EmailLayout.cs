using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>One piece of an email: a paragraph, a details table, a bullet list, a call-out, a button or a small note.</summary>
    public sealed class EmailBlock
    {
        public string Kind { get; private init; } = "p";
        public string Text { get; private init; } = string.Empty;
        public string Url { get; private init; } = string.Empty;
        public string Tone { get; private init; } = "info";
        public List<KeyValuePair<string, string>> Rows { get; private init; } = new();
        public List<string> Items { get; private init; } = new();

        /// <summary>A paragraph. Put **words** between double stars to make them bold.</summary>
        public static EmailBlock Paragraph(string text) => new() { Kind = "p", Text = text };

        /// <summary>A small grey note.</summary>
        public static EmailBlock Note(string text) => new() { Kind = "note", Text = text };

        /// <summary>Label and value rows (ticket number, category, due time, and so on). Empty values are left out.</summary>
        public static EmailBlock Details(params (string Label, string Value)[] rows)
        {
            var block = new EmailBlock { Kind = "details" };
            foreach (var row in rows)
                if (!string.IsNullOrWhiteSpace(row.Value))
                    block.Rows.Add(new KeyValuePair<string, string>(row.Label, row.Value));
            return block;
        }

        public static EmailBlock Bullets(params string[] items) => new() { Kind = "bullets", Items = items.ToList() };

        /// <summary>A highlighted box. Tone: info, success, warning or danger.</summary>
        public static EmailBlock Callout(string text, string tone = "info") => new() { Kind = "callout", Text = text, Tone = tone };

        public static EmailBlock Button(string text, string url) => new() { Kind = "button", Text = text, Url = url };
    }

    /// <summary>What an email says. The layout turns it into HTML and plain text.</summary>
    public sealed class EmailContent
    {
        public string Subject { get; init; } = string.Empty;
        public string Heading { get; init; } = string.Empty;
        public string Preheader { get; init; } = string.Empty;
        public string Greeting { get; init; } = string.Empty;
        /// <summary>A short status label above the heading, for example "Action required". Empty means none.</summary>
        public string Label { get; init; } = string.Empty;
        /// <summary>Colour of the label: info, success, warning or danger.</summary>
        public string LabelTone { get; init; } = "info";
        public List<EmailBlock> Blocks { get; init; } = new();
        /// <summary>When true the sign-off reads as an automatic message, not a personal one.</summary>
        public bool Automatic { get; init; }
    }

    /// <summary>
    /// The Access Desk email design (its own look, not People Hub's): a navy header with the two-tone wordmark, a status label,
    /// a clean white body, key facts under a green rule, a navy button with an orange edge, and a dark footer under a
    /// three-colour band in the company colours. Tables and inline styles only, so it works in Outlook, Gmail and on phones.
    /// Every value is HTML-encoded here, so names and messages can never inject markup.
    /// </summary>
    public static class EmailLayout
    {
        private static readonly Regex Bold = new(@"\*\*(.+?)\*\*", RegexOptions.Compiled);
        private const string Font = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
        private const string Ink = "#0B1F3A";
        private const string Body = "#3D4A5C";
        private const string Muted = "#6B7A90";
        private const string Line = "#E3E8EF";
        private const string Page = "#EEF1F6";

        private static string Enc(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);

        /// <summary>Encodes the text, then turns **words** into bold and line breaks into line breaks.</summary>
        private static string Rich(string? value)
        {
            var encoded = Bold.Replace(Enc(value), "<strong style=\"color:" + Ink + ";\">$1</strong>");
            return encoded.Replace("\r\n", "\n").Replace("\n", "<br/>");
        }

        private static string SafeUrl(string url) =>
            Uri.TryCreate((url ?? string.Empty).Trim(), UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
                ? uri.ToString() : "#";

        /// <summary>Background, edge and text colour for a tone.</summary>
        private static (string Back, string Edge, string Text) Tone(EmailBrand brand, string tone) => tone switch
        {
            "success" => ("#F2F9E8", brand.SecondaryColor, "#3E6B0F"),
            "warning" => ("#FFF4E6", brand.AccentColor, "#8A4500"),
            "danger" => ("#FDEDED", "#C93B3B", "#7C1D1D"),
            _ => ("#EEF3FA", brand.PrimaryColor, brand.PrimaryColor)
        };

        /// <summary>The app name with its last word in the secondary colour, for example Access <green>Desk</green>.</summary>
        private static string Wordmark(EmailBrand brand)
        {
            var name = brand.AppName.Trim();
            var split = name.LastIndexOf(' ');
            if (split <= 0) return Enc(name);
            return Enc(name.Substring(0, split + 1)) + "<span style=\"color:" + brand.SecondaryColor + ";\">" + Enc(name.Substring(split + 1)) + "</span>";
        }

        public static string RenderHtml(EmailContent content, EmailBrand? brandOverride = null)
        {
            var brand = brandOverride ?? EmailBrand.Current;
            var sb = new StringBuilder();

            sb.Append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/>");
            sb.Append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>");
            sb.Append("<meta name=\"x-apple-disable-message-reformatting\"/>");
            sb.Append("<title>").Append(Enc(content.Subject)).Append("</title>");
            sb.Append("<style>@media only screen and (max-width:620px){.card{width:100%!important}.px{padding-left:22px!important;padding-right:22px!important}.team{display:none!important}.btn a{display:block!important;text-align:center!important}}</style>");
            sb.Append("</head><body style=\"margin:0;padding:0;background-color:").Append(Page).Append(";\">");

            // Hidden preview text next to the subject in the inbox.
            sb.Append("<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:").Append(Page).Append(";font-size:1px;line-height:1px;\">")
              .Append(Enc(content.Preheader)).Append("</div>");

            sb.Append("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" bgcolor=\"").Append(Page).Append("\" style=\"background-color:").Append(Page).Append(";\"><tr><td align=\"center\" style=\"padding:32px 12px;\">");
            sb.Append("<table role=\"presentation\" class=\"card\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:600px;max-width:600px;background-color:#FFFFFF;border:1px solid ").Append(Line).Append(";\">");

            // Header: navy band, wordmark on the left, team on the right.
            sb.Append("<tr><td class=\"px\" bgcolor=\"").Append(brand.PrimaryColor).Append("\" style=\"background-color:").Append(brand.PrimaryColor).Append(";padding:22px 36px;\">")
              .Append("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\"><tr>")
              .Append("<td style=\"font-family:").Append(Font).Append(";font-size:21px;line-height:1.2;font-weight:700;letter-spacing:0.2px;color:#FFFFFF;\">").Append(Wordmark(brand)).Append("</td>")
              .Append("<td class=\"team\" align=\"right\" style=\"font-family:").Append(Font).Append(";font-size:12px;line-height:1.3;color:#C9D6EA;letter-spacing:0.3px;\">")
              .Append(Enc(brand.TeamName)).Append("<br/><span style=\"color:#8FA6C9;\">").Append(Enc(brand.CompanyName)).Append("</span></td>")
              .Append("</tr></table></td></tr>");

            // Body.
            sb.Append("<tr><td class=\"px\" style=\"padding:34px 36px 8px 36px;font-family:").Append(Font).Append(";color:").Append(Body).Append(";font-size:15px;line-height:1.65;\">");

            if (!string.IsNullOrWhiteSpace(content.Label))
            {
                var tone = Tone(brand, content.LabelTone);
                sb.Append("<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:0 0 14px 0;\"><tr><td style=\"background-color:")
                  .Append(tone.Back).Append(";border:1px solid ").Append(tone.Edge).Append(";border-radius:12px;padding:3px 11px;font-family:").Append(Font)
                  .Append(";font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:").Append(tone.Text).Append(";\">")
                  .Append(Enc(content.Label)).Append("</td></tr></table>");
            }
            if (!string.IsNullOrWhiteSpace(content.Heading))
                sb.Append("<h1 style=\"margin:0 0 20px 0;font-family:").Append(Font).Append(";font-size:24px;line-height:1.3;font-weight:700;color:").Append(Ink).Append(";\">").Append(Enc(content.Heading)).Append("</h1>");
            if (!string.IsNullOrWhiteSpace(content.Greeting))
                sb.Append("<p style=\"margin:0 0 16px 0;\">").Append(Rich(content.Greeting)).Append("</p>");

            foreach (var block in content.Blocks)
            {
                switch (block.Kind)
                {
                    case "p":
                        sb.Append("<p style=\"margin:0 0 16px 0;\">").Append(Rich(block.Text)).Append("</p>");
                        break;
                    case "note":
                        sb.Append("<p style=\"margin:0 0 16px 0;font-size:13px;line-height:1.55;color:").Append(Muted).Append(";\">").Append(Rich(block.Text)).Append("</p>");
                        break;
                    case "bullets":
                        sb.Append("<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:0 0 16px 0;\">");
                        foreach (var item in block.Items)
                            sb.Append("<tr><td valign=\"top\" style=\"padding:0 10px 6px 0;font-family:").Append(Font).Append(";font-size:15px;line-height:1.65;color:").Append(brand.AccentColor).Append(";\">&#9632;</td>")
                              .Append("<td style=\"padding:0 0 6px 0;font-family:").Append(Font).Append(";font-size:15px;line-height:1.65;color:").Append(Body).Append(";\">").Append(Rich(item)).Append("</td></tr>");
                        sb.Append("</table>");
                        break;
                    case "details":
                        if (block.Rows.Count == 0) break;
                        sb.Append("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:4px 0 22px 0;border-top:3px solid ").Append(brand.SecondaryColor).Append(";\">");
                        foreach (var row in block.Rows)
                        {
                            sb.Append("<tr><td style=\"padding:11px 12px 11px 0;border-bottom:1px solid ").Append(Line).Append(";font-family:").Append(Font)
                              .Append(";font-size:11px;line-height:1.5;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:").Append(Muted).Append(";width:38%;vertical-align:top;\">")
                              .Append(Enc(row.Key)).Append("</td><td style=\"padding:10px 0;border-bottom:1px solid ").Append(Line).Append(";font-family:").Append(Font)
                              .Append(";font-size:14px;line-height:1.5;font-weight:600;color:").Append(Ink).Append(";vertical-align:top;\">").Append(Rich(row.Value)).Append("</td></tr>");
                        }
                        sb.Append("</table>");
                        break;
                    case "callout":
                        var t = Tone(brand, block.Tone);
                        sb.Append("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:0 0 20px 0;\"><tr><td style=\"background-color:")
                          .Append(t.Back).Append(";border-left:4px solid ").Append(t.Edge).Append(";padding:14px 18px;font-family:").Append(Font)
                          .Append(";font-size:14px;line-height:1.6;color:").Append(t.Text).Append(";\">").Append(Rich(block.Text)).Append("</td></tr></table>");
                        break;
                    case "button":
                        var href = SafeUrl(block.Url);
                        sb.Append("<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" class=\"btn\" style=\"margin:6px 0 14px 0;\"><tr><td bgcolor=\"")
                          .Append(brand.PrimaryColor).Append("\" style=\"background-color:").Append(brand.PrimaryColor).Append(";border-bottom:3px solid ").Append(brand.AccentColor).Append(";border-radius:4px;\">")
                          .Append("<a href=\"").Append(Enc(href)).Append("\" target=\"_blank\" style=\"display:inline-block;padding:13px 26px;font-family:").Append(Font)
                          .Append(";font-size:14px;font-weight:600;letter-spacing:0.3px;color:#FFFFFF;text-decoration:none;\">").Append(Enc(block.Text)).Append(" &rarr;</a></td></tr></table>");
                        sb.Append("<p style=\"margin:0 0 20px 0;font-size:12px;line-height:1.5;color:").Append(Muted).Append(";word-break:break-all;\">Or copy this link: <a href=\"")
                          .Append(Enc(href)).Append("\" style=\"color:").Append(brand.PrimaryColor).Append(";\">").Append(Enc(href)).Append("</a></p>");
                        break;
                }
            }

            // Sign-off, under a hairline.
            sb.Append("<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:10px 0 28px 0;\"><tr><td style=\"border-top:1px solid ").Append(Line)
              .Append(";padding-top:18px;font-family:").Append(Font).Append(";font-size:13px;line-height:1.6;color:").Append(Muted).Append(";\">");
            if (content.Automatic)
                sb.Append("Sent automatically by <strong style=\"color:").Append(brand.PrimaryColor).Append(";\">").Append(Enc(brand.AppName)).Append("</strong>. Replies to this address are not read.");
            else
                sb.Append("Regards,<br/><strong style=\"color:").Append(brand.PrimaryColor).Append(";\">").Append(Enc(brand.TeamName)).Append("</strong> &middot; ").Append(Enc(brand.AppName));
            sb.Append("</td></tr></table>");
            sb.Append("</td></tr>");

            // Three-colour band in the company colours.
            sb.Append("<tr><td style=\"font-size:0;line-height:0;\"><table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\"><tr>")
              .Append("<td width=\"50%\" height=\"4\" bgcolor=\"").Append(brand.SecondaryColor).Append("\" style=\"background-color:").Append(brand.SecondaryColor).Append(";height:4px;line-height:4px;font-size:0;\">&nbsp;</td>")
              .Append("<td width=\"25%\" height=\"4\" bgcolor=\"").Append(brand.AccentColor).Append("\" style=\"background-color:").Append(brand.AccentColor).Append(";height:4px;line-height:4px;font-size:0;\">&nbsp;</td>")
              .Append("<td width=\"25%\" height=\"4\" bgcolor=\"").Append(brand.PrimaryColor).Append("\" style=\"background-color:").Append(brand.PrimaryColor).Append(";height:4px;line-height:4px;font-size:0;\">&nbsp;</td>")
              .Append("</tr></table></td></tr>");

            // Footer: dark, with the legal name, the confidentiality line and the support address.
            sb.Append("<tr><td class=\"px\" bgcolor=\"").Append(Ink).Append("\" style=\"background-color:").Append(Ink).Append(";padding:22px 36px;font-family:").Append(Font)
              .Append(";font-size:12px;line-height:1.65;color:#AFC0DA;\">");
            if (!string.IsNullOrEmpty(brand.LogoUrl))
                sb.Append("<img src=\"").Append(Enc(brand.LogoUrl)).Append("\" alt=\"").Append(Enc(brand.CompanyName)).Append("\" height=\"28\" style=\"display:block;height:28px;border:0;margin:0 0 12px 0;\"/>");
            sb.Append("<strong style=\"color:#FFFFFF;\">").Append(Enc(brand.LegalName)).Append("</strong><br/>");
            sb.Append("This message is meant only for the person it was sent to. If it reached you by mistake, tell <a href=\"mailto:")
              .Append(Enc(brand.SupportEmail)).Append("\" style=\"color:").Append(brand.SecondaryColor).Append(";text-decoration:none;\">").Append(Enc(brand.SupportEmail)).Append("</a> and delete it.");
            sb.Append("</td></tr>");

            sb.Append("</table></td></tr></table></body></html>");
            return sb.ToString();
        }

        public static string RenderText(EmailContent content, EmailBrand? brandOverride = null)
        {
            var brand = brandOverride ?? EmailBrand.Current;
            var sb = new StringBuilder();
            string Plain(string? value) => Bold.Replace(value ?? string.Empty, "$1");

            sb.AppendLine(brand.AppName.ToUpperInvariant() + " | " + brand.TeamName);
            sb.AppendLine(new string('=', 48));
            sb.AppendLine();
            if (!string.IsNullOrWhiteSpace(content.Label)) sb.AppendLine("[" + content.Label.ToUpperInvariant() + "]");
            if (!string.IsNullOrWhiteSpace(content.Heading)) { sb.AppendLine(content.Heading); sb.AppendLine(); }
            if (!string.IsNullOrWhiteSpace(content.Greeting)) { sb.AppendLine(Plain(content.Greeting)); sb.AppendLine(); }
            foreach (var block in content.Blocks)
            {
                switch (block.Kind)
                {
                    case "details":
                        foreach (var row in block.Rows) sb.AppendLine(row.Key + ": " + Plain(row.Value));
                        sb.AppendLine();
                        break;
                    case "bullets":
                        foreach (var item in block.Items) sb.AppendLine("- " + Plain(item));
                        sb.AppendLine();
                        break;
                    case "button":
                        sb.AppendLine(block.Text + ": " + block.Url);
                        sb.AppendLine();
                        break;
                    default:
                        sb.AppendLine(Plain(block.Text));
                        sb.AppendLine();
                        break;
                }
            }
            sb.AppendLine(content.Automatic
                ? "Sent automatically by " + brand.AppName + ". Replies to this address are not read."
                : "Regards," + Environment.NewLine + brand.TeamName + " - " + brand.AppName);
            sb.AppendLine();
            sb.AppendLine("-- " + brand.LegalName + " | " + brand.SupportEmail);
            return sb.ToString();
        }

        /// <summary>Plain text made from a ready-made HTML body, for callers that only have HTML.</summary>
        public static string HtmlToText(string html)
        {
            if (string.IsNullOrEmpty(html)) return string.Empty;
            var text = Regex.Replace(html, @"<(style|head|script)[^>]*>.*?</\1>", string.Empty, RegexOptions.Singleline | RegexOptions.IgnoreCase);
            text = Regex.Replace(text, @"<\s*(br|/p|/h\d|/li|/tr)\s*/?>", "\n", RegexOptions.IgnoreCase);
            text = Regex.Replace(text, @"<[^>]+>", string.Empty);
            text = WebUtility.HtmlDecode(text);
            text = Regex.Replace(text, @"[ \t]+", " ");
            text = Regex.Replace(text, @"\n\s*\n\s*\n+", "\n\n");
            return text.Trim();
        }
    }
}
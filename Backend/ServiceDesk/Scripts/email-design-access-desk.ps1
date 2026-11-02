# Access Desk email design: its own corporate look instead of People Hub's.
# Navy header with the two-tone "Access Desk" wordmark, a status label (Action required, Notification, System check...),
# key facts under a green rule, a navy button with an orange edge, and a dark footer under a green / orange / navy band.
# Replaces the People Hub EmailLayout.cs with the Access Desk one (same building blocks, so nothing else changes),
# sets the app name to Access Desk, and adds design tests.
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk with the API stopped:  .\Scripts\email-design-access-desk.ps1
# No database change. On any failure, every file is put back as it was.

$ErrorActionPreference = 'Stop'
$here = (Get-Location).Path
$root = $null
foreach ($candidate in @($here, (Join-Path $here 'ServiceDeskAPI'))) {
    if ((Test-Path (Join-Path $candidate 'ServiceDeskAPI\ServiceDeskAPI.csproj')) -and (Test-Path (Join-Path $candidate 'tests\ServiceDeskAPI.Tests'))) { $root = $candidate; break }
}
if (-not $root) { Write-Host 'Run this from C:\Users\<you>\Desktop\PRO\ServiceDesk.' -ForegroundColor Red; return }
Write-Host "  Solution root: $root"

$api = Join-Path $root 'ServiceDeskAPI'
$sln = @(Get-ChildItem $root -File | Where-Object { $_.Name -like '*.sln' -or $_.Name -like '*.slnx' })[0].FullName
$settingsPath = Join-Path $api 'appsettings.json'
$layoutPath = Join-Path $api 'Infrastructure\Email\EmailLayout.cs'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-NormHash([string]$path) {
    $t = [System.IO.File]::ReadAllText($path).Replace("`r`n", "`n")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($t)))).Replace('-', '').ToLowerInvariant()
}

if (-not (Test-Path $layoutPath)) { Write-Host 'EmailLayout.cs not found: run step1c-email.ps1 first.' -ForegroundColor Red; return }
$layoutOld = [System.IO.File]::ReadAllText($layoutPath)
if ($layoutOld.Contains('The Access Desk email design')) { Write-Host 'The Access Desk design is already in place. Nothing changed.' -ForegroundColor Yellow; return }
if (-not $layoutOld.Contains('namespace ServiceDeskAPI.Infrastructure.Email') -or -not $layoutOld.Contains('class EmailBlock')) {
    Write-Host 'EmailLayout.cs is not the Step 1c version. Send me the file.' -ForegroundColor Red; return
}
$expected = [ordered]@{
    'ServiceDeskAPI\Infrastructure\Email\EmailBrand.cs' = '7f85be33786961e9e1b7dd2625f950e9424b1766ccf80d7e857017d1a34cab68'
    'ServiceDeskAPI\Infrastructure\Email\EmailTemplates.cs' = 'c6b98df54b16037f45d226975a6b7b62211901f1b4d6de4c9ac9ba49dee22a56'
    'ServiceDeskAPI\Infrastructure\Email\NotificationMail.cs' = 'd49ae45165c8fc677783b67d6f0196094a473da925c59f1ee70f18a05dfa47c4'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed after Step 1c, so nothing was changed:' -ForegroundColor Red
    $changedByYou | ForEach-Object { Write-Host "    $_" }
    Write-Host 'Send me those files.'
    return
}
$settingsOld = [System.IO.File]::ReadAllText($settingsPath)
$settingsNew = $settingsOld.Replace('"AppName": "Access Pensions Service Desk"', '"AppName": "Access Desk"')

$files = [ordered]@{}
$files['ServiceDeskAPI\Infrastructure\Email\EmailBrand.cs'] = @'
using System.Text.RegularExpressions;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// How the emails look and who they come from (copied from People Hub, Service Desk defaults). Read at start-up from
    /// EmailSettings:Brand. Colours and addresses are checked, so a bad setting falls back to the default instead of breaking the layout.
    /// </summary>
    public sealed class EmailBrand
    {
        public string CompanyName { get; init; } = "Access Pensions";
        public string LegalName { get; init; } = "Access ARM Pensions Plc";
        /// <summary>Signs the emails and is the default sender name.</summary>
        public string TeamName { get; init; } = "Contribution Processing";
        /// <summary>The application name: the header wordmark (last word in the secondary colour) and the sign-off.</summary>
        public string AppName { get; init; } = "Access Desk";
        /// <summary>Public address of the logo image (PNG). Empty means a text wordmark.</summary>
        public string LogoUrl { get; init; } = string.Empty;
        public string PrimaryColor { get; init; } = "#003883";
        public string AccentColor { get; init; } = "#FF8200";
        public string SecondaryColor { get; init; } = "#8DC63F";
        /// <summary>Kept for compatibility with the People Hub layout; not used by the Service Desk.</summary>
        public string CareersUrl { get; init; } = string.Empty;
        /// <summary>Shown in the footer as the address to tell if a message arrived by mistake. Set EmailSettings:Brand:SupportEmail.</summary>
        public string SupportEmail { get; init; } = "servicedesk@accesspensions.ng";

        /// <summary>The brand used by every email. Set once at start-up; the defaults apply until then.</summary>
        public static EmailBrand Current { get; set; } = new EmailBrand();

        private static readonly Regex Colour = new("^#[0-9a-fA-F]{6}$", RegexOptions.Compiled);

        public static EmailBrand FromConfiguration(IConfiguration configuration)
        {
            var section = configuration.GetSection("EmailSettings:Brand");
            var d = new EmailBrand();

            string Text(string key, string fallback)
            {
                var value = section[key];
                return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
            }
            string Hex(string key, string fallback)
            {
                var value = section[key];
                return !string.IsNullOrWhiteSpace(value) && Colour.IsMatch(value.Trim()) ? value.Trim() : fallback;
            }
            string Url(string key, string fallback)
            {
                var value = section[key];
                if (string.IsNullOrWhiteSpace(value)) return fallback;
                return Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
                    ? uri.ToString() : fallback;
            }

            return new EmailBrand
            {
                CompanyName = Text("CompanyName", d.CompanyName),
                LegalName = Text("LegalName", d.LegalName),
                TeamName = Text("TeamName", d.TeamName),
                AppName = Text("AppName", d.AppName),
                LogoUrl = Url("LogoUrl", string.Empty),
                PrimaryColor = Hex("PrimaryColor", d.PrimaryColor),
                AccentColor = Hex("AccentColor", d.AccentColor),
                SecondaryColor = Hex("SecondaryColor", d.SecondaryColor),
                CareersUrl = Url("CareersUrl", d.CareersUrl),
                SupportEmail = Text("SupportEmail", d.SupportEmail)
            };
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\EmailLayout.cs'] = @'
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
'@
$files['ServiceDeskAPI\Infrastructure\Email\EmailTemplates.cs'] = @'
using System.Globalization;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>A finished email: subject, HTML and plain text.</summary>
    public sealed record EmailMessageParts(string Subject, string Html, string Text);

    /// <summary>
    /// The wording of the Service Desk's own emails (copied from People Hub's EmailTemplates; the HR messages were left out).
    /// Ticket emails are added in Step 8. Change the words here; the look is in EmailLayout.
    /// </summary>
    public static class EmailTemplates
    {
        private static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("en-GB");

        /// <summary>A stored UTC time written in Lagos time (WAT, UTC+1, no daylight saving), as the BRD requires.</summary>
        public static string LagosText(DateTime utc) => utc.AddHours(1).ToString("dddd, d MMMM yyyy 'at' HH:mm", Culture) + " WAT";

        public static EmailMessageParts Build(EmailContent content, EmailBrand? brand = null)
            => new(content.Subject, EmailLayout.RenderHtml(content, brand), EmailLayout.RenderText(content, brand));

        public static EmailMessageParts Test(string requestedBy, EmailBrand? brand = null)
        {
            var b = brand ?? EmailBrand.Current;
            return Build(new EmailContent
            {
                Subject = "Test email from " + b.AppName,
                Heading = "Email is working",
                Preheader = "This is a test message from " + b.AppName + ".",
                Greeting = "Hello,",
                Label = "System check",
                LabelTone = "success",
                Automatic = true,
                Blocks =
                {
                    EmailBlock.Callout("Your " + b.AppName + " email setup works. This message was sent by **" + requestedBy + "** as a test.", "success"),
                    EmailBlock.Details(("Sent by", requestedBy), ("Sent at", LagosText(DateTime.UtcNow)))
                }
            }, b);
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\NotificationMail.cs'] = @'
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>One in-app notification that should also reach the person's inbox (copied from People Hub).</summary>
    public sealed record NotificationMail(Guid UserId, string Title, string Message, NotificationType Type, NotificationCategory Category, string? Link)
    {
        public static NotificationMail From(InAppNotification n) => new(n.RecipientUserId, n.Title, n.Message, n.Type, n.Category, n.DeepLinkUrl);
    }

    /// <summary>Holds notifications waiting to be emailed. Best effort and in memory: the in-app copy is the record.</summary>
    public sealed class NotificationMailQueue
    {
        private readonly Channel<NotificationMail> _channel = Channel.CreateBounded<NotificationMail>(
            new BoundedChannelOptions(5000) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });

        public bool Enqueue(NotificationMail mail) => _channel.Writer.TryWrite(mail);

        public IAsyncEnumerable<NotificationMail> ReadAllAsync(CancellationToken cancellationToken) => _channel.Reader.ReadAllAsync(cancellationToken);
    }

    /// <summary>
    /// Watches every save. Notifications added in the save are queued for email only after the save succeeded,
    /// so nobody is emailed about something that was rolled back.
    /// </summary>
    public sealed class NotificationMailInterceptor : SaveChangesInterceptor
    {
        private readonly NotificationMailQueue _queue;
        private readonly ConditionalWeakTable<DbContext, List<NotificationMail>> _pending = new();

        public NotificationMailInterceptor(NotificationMailQueue queue) => _queue = queue;

        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
        {
            Collect(eventData.Context);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Collect(eventData.Context);
            return ValueTask.FromResult(result);
        }

        public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
        {
            Flush(eventData.Context);
            return result;
        }

        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            Flush(eventData.Context);
            return ValueTask.FromResult(result);
        }

        public override void SaveChangesFailed(DbContextErrorEventData eventData) => Discard(eventData.Context);

        public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
        {
            Discard(eventData.Context);
            return Task.CompletedTask;
        }

        private void Collect(DbContext? context)
        {
            if (context == null) return;
            var list = _pending.GetOrCreateValue(context);
            list.Clear();
            foreach (var entry in context.ChangeTracker.Entries<InAppNotification>())
                if (entry.State == EntityState.Added)
                    list.Add(NotificationMail.From(entry.Entity));
        }

        private void Flush(DbContext? context)
        {
            if (context == null || !_pending.TryGetValue(context, out var list)) return;
            foreach (var mail in list) _queue.Enqueue(mail);
            list.Clear();
        }

        private void Discard(DbContext? context)
        {
            if (context != null && _pending.TryGetValue(context, out var list)) list.Clear();
        }
    }

    /// <summary>Settings: EmailSettings:Notifications:Enabled (default true) and :ExcludeCategories (comma list, for example "Report,System").</summary>
    public static class NotificationMailPolicy
    {
        public static bool ShouldSend(IConfiguration config, NotificationCategory category)
        {
            var enabled = config["EmailSettings:Notifications:Enabled"];
            if (!string.IsNullOrWhiteSpace(enabled) && enabled.Trim().Equals("false", StringComparison.OrdinalIgnoreCase)) return false;
            var excluded = (config["EmailSettings:Notifications:ExcludeCategories"] ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return !excluded.Any(x => x.Equals(category.ToString(), StringComparison.OrdinalIgnoreCase));
        }
    }

    /// <summary>The wording of the email copy of a notification. The look comes from EmailLayout.</summary>
    public static class NotificationEmail
    {
        /// <summary>Turns an in-app route such as /tickets/123 into a full address. Full addresses are kept as they are.</summary>
        public static string? LinkFor(string? link, string frontendUrl)
        {
            if (string.IsNullOrWhiteSpace(link)) return null;
            var value = link.Trim();
            if (value.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || value.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                return value;
            return frontendUrl.TrimEnd('/') + (value.StartsWith('/') ? value : "/" + value);
        }

        private static string FirstName(string? name) =>
            (name ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? string.Empty;

        public static EmailMessageParts Build(string recipientName, string title, string message, NotificationType type,
            NotificationCategory category, string? link, string frontendUrl, EmailBrand? brand = null)
        {
            var b = brand ?? EmailBrand.Current;
            var preview = message.Length > 140 ? message.Substring(0, 140) + "..." : message;
            var blocks = new List<EmailBlock> { EmailBlock.Paragraph(message) };
            if (type == NotificationType.ActionRequired)
                blocks.Add(EmailBlock.Callout("**Action needed.** Please open the ticket and complete your part.", "warning"));
            else if (type == NotificationType.Warning)
                blocks.Add(EmailBlock.Callout("Please review this when you can.", "warning"));
            var url = LinkFor(link, frontendUrl);
            if (url != null) blocks.Add(EmailBlock.Button("Open in " + b.AppName, url));
            blocks.Add(EmailBlock.Note("You are receiving this because you have a part in this ticket. This is an automatic message."));

            var first = FirstName(recipientName);
            return EmailTemplates.Build(new EmailContent
            {
                Subject = (type == NotificationType.ActionRequired ? "Action required: " : string.Empty) + title,
                Heading = title,
                Preheader = preview,
                Greeting = first.Length > 0 ? "Hello " + first + "," : "Hello,",
                Label = type switch
                {
                    NotificationType.ActionRequired => "Action required",
                    NotificationType.Warning => "Attention",
                    NotificationType.Success => "Update",
                    _ => "Notification"
                },
                LabelTone = type switch
                {
                    NotificationType.ActionRequired => "warning",
                    NotificationType.Warning => "warning",
                    NotificationType.Success => "success",
                    _ => "info"
                },
                Automatic = true,
                Blocks = blocks
            }, b);
        }
    }

    /// <summary>Sends the queued notification emails one by one in the background. A failure is logged and never reaches the caller.</summary>
    public sealed class NotificationMailWorker : BackgroundService
    {
        private readonly NotificationMailQueue _queue;
        private readonly IServiceScopeFactory _scopes;
        private readonly IConfiguration _config;
        private readonly ILogger<NotificationMailWorker> _logger;

        public NotificationMailWorker(NotificationMailQueue queue, IServiceScopeFactory scopes, IConfiguration config, ILogger<NotificationMailWorker> logger)
        {
            _queue = queue;
            _scopes = scopes;
            _config = config;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try
            {
                await foreach (var mail in _queue.ReadAllAsync(stoppingToken))
                {
                    try { await SendAsync(mail, stoppingToken); }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
                    catch (Exception ex) { _logger.LogWarning(ex, "A notification email could not be sent."); }
                }
            }
            catch (OperationCanceledException)
            {
                // The app is stopping.
            }
        }

        private async Task SendAsync(NotificationMail mail, CancellationToken ct)
        {
            if (!NotificationMailPolicy.ShouldSend(_config, mail.Category)) return;

            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var person = await db.Users.AsNoTracking()
                .Where(u => u.Id == mail.UserId && u.IsActive)
                .Select(u => new { u.FullName, u.UserName, u.CorporateEmail, u.Email })
                .FirstOrDefaultAsync(ct);
            if (person == null) return;

            var to = (!string.IsNullOrWhiteSpace(person.CorporateEmail) ? person.CorporateEmail : person.Email)?.Trim();
            if (string.IsNullOrWhiteSpace(to) || !to.Contains('@')) return;

            var frontend = (_config["Frontend:Url"] ?? "http://localhost:5174").Split(',')[0].Trim();
            var parts = NotificationEmail.Build(person.FullName ?? person.UserName ?? string.Empty, mail.Title, mail.Message, mail.Type, mail.Category, mail.Link, frontend);

            var email = scope.ServiceProvider.GetRequiredService<IEmailService>();
            var (ok, message) = await email.SendEmailAsync(to, parts.Subject, parts.Html);
            if (!ok)
                _logger.LogWarning("The notification email to user {UserId} was not sent: {Message}", mail.UserId, message);
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Email\EmailDesignTests.cs'] = @'
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Email;
using Xunit;

namespace ServiceDeskAPI.Tests.Email
{
    /// <summary>The Access Desk email design: own wordmark, company colours, status label, safe text.</summary>
    public class EmailDesignTests
    {
        private static readonly EmailBrand Brand = new();

        [Fact]
        public void The_header_shows_the_Access_Desk_wordmark_in_the_company_colours()
        {
            var html = EmailTemplates.Test("Test Super Admin", Brand).Html;

            Assert.Contains("Access <span style=\"color:#8DC63F;\">Desk</span>", html);
            Assert.Contains("#003883", html);
            Assert.Contains("#FF8200", html);
            Assert.DoesNotContain("People Hub", html);
        }

        [Fact]
        public void Each_notification_type_gets_its_status_label()
        {
            string Html(NotificationType type) =>
                NotificationEmail.Build("Amaka Obi", "Ticket CP-1 assigned", "Message", type, NotificationCategory.Assignment, "/tickets/1", "https://desk.test", Brand).Html;

            Assert.Contains("Action required", Html(NotificationType.ActionRequired));
            Assert.Contains(">Notification<", Html(NotificationType.Info));
            Assert.Contains(">Update<", Html(NotificationType.Success));
        }

        [Fact]
        public void The_plain_text_version_carries_the_label_and_the_link()
        {
            var text = NotificationEmail.Build("Amaka Obi", "Ticket CP-1 assigned", "Message", NotificationType.ActionRequired,
                NotificationCategory.Assignment, "/tickets/1", "https://desk.test", Brand).Text;

            Assert.Contains("[ACTION REQUIRED]", text);
            Assert.Contains("https://desk.test/tickets/1", text);
            Assert.StartsWith("ACCESS DESK", text);
        }

        [Fact]
        public void A_label_cannot_inject_markup()
        {
            var html = EmailLayout.RenderHtml(new EmailContent { Subject = "s", Heading = "h", Label = "<b>x</b>" }, Brand);
            Assert.DoesNotContain("<b>x</b>", html);
        }
    }
}
'@

$backup = @{}
foreach ($rel in $files.Keys) {
    $full = Join-Path $root $rel
    $backup[$full] = if (Test-Path $full) { [System.IO.File]::ReadAllText($full) } else { $null }
}
$backup[$settingsPath] = $settingsOld
function Restore-All {
    foreach ($full in $backup.Keys) {
        if ($null -eq $backup[$full]) { if (Test-Path $full) { Remove-Item $full -Force } }
        else { [System.IO.File]::WriteAllText($full, $backup[$full], $utf8) }
    }
}

try {
    Write-Host ("1/2 Writing the Access Desk email design ({0} files)..." -f $files.Count)
    foreach ($rel in $files.Keys) {
        $full = Join-Path $root $rel
        $dir = Split-Path $full -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllText($full, $files[$rel].Replace("`r`n", "`n").Replace("`n", "`r`n"), $utf8)
    }
    if ($settingsNew -ne $settingsOld) { [System.IO.File]::WriteAllText($settingsPath, $settingsNew, $utf8); Write-Host '  appsettings.json: AppName is now Access Desk' }
    else { Write-Host '  appsettings.json: AppName left as you set it' }

    Write-Host '2/2 Building and running all tests...'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $b = & dotnet build $sln -nologo -v q 2>&1 | ForEach-Object { "$_" }; $buildExit = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($buildExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 20 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed.' }
    $ErrorActionPreference = 'Continue'
    $t = & dotnet test $sln --no-build -nologo 2>&1 | ForEach-Object { "$_" }; $testExit = $LASTEXITCODE
    $ErrorActionPreference = $old
    $t | Where-Object { $_ -match 'Passed!|Failed!|^\s*Failed ' } | ForEach-Object { Write-Host "  $_" }
    if ($testExit -ne 0) { $t | Where-Object { $_ -match 'Error Message|Assert' } | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }; throw 'Tests failed.' }

    Write-Host ''
    Write-Host 'Done. Start the API and send POST /api/admin/email/test again to see the new design.' -ForegroundColor Green
}
catch {
    Write-Host ('FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    Restore-All
    Write-Host 'Every file was put back as it was.' -ForegroundColor Yellow
    exit 1
}

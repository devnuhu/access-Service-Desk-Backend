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
        public string LegalName { get; init; } = "Access Pensions Ltd";
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
        public string SupportEmail { get; init; } = "ict@accesspensions.ng";

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
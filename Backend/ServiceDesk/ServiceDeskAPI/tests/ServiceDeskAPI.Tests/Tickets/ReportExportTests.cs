using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClosedXML.Excel;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Infrastructure.Reports;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Step 9c: Excel and CSV downloads.</summary>
    public class ReportExportTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public ReportExportTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private static ReportResultDto Sample() => new()
        {
            Title = "Sample report", GeneratedAt = new DateTime(2026, 11, 17, 12, 0, 0, DateTimeKind.Utc), From = "2026-11-01", To = "2026-11-17",
            Columns = new()
            {
                new ReportColumnDto("name", "Name", "text"), new ReportColumnDto("count", "Tickets", "number"),
                new ReportColumnDto("pct", "Within time %", "percent"), new ReportColumnDto("at", "Raised", "datetime"),
                new ReportColumnDto("flag", "Escalated", "boolean")
            },
            Rows = new()
            {
                new() { "=HYPERLINK(\"http://bad\",\"x\")", 5, 87.5, new DateTime(2026, 11, 16, 7, 0, 0, DateTimeKind.Utc), true },
                new() { "Plain, with comma", 2, null, null, false }
            },
            Totals = new() { "Total", 7, 87.5, null, null }
        };

        [Fact]
        public void The_Excel_file_has_headings_typed_cells_and_never_runs_text_as_a_formula()
        {
            var bytes = ReportExporter.ToXlsx(Sample(), 1);
            using var workbook = new XLWorkbook(new MemoryStream(bytes));
            var sheet = workbook.Worksheet("Report");
            Assert.Equal("Sample report", sheet.Cell(1, 1).GetString());
            Assert.Equal("Name", sheet.Cell(4, 1).GetString());
            Assert.Equal("Tickets", sheet.Cell(4, 2).GetString());

            var risky = sheet.Cell(5, 1);
            Assert.Equal(XLDataType.Text, risky.DataType);
            Assert.False(risky.HasFormula);
            Assert.Equal("=HYPERLINK(\"http://bad\",\"x\")", risky.GetString());

            Assert.Equal(5, sheet.Cell(5, 2).GetDouble());
            Assert.Equal(87.5, sheet.Cell(5, 3).GetDouble());
            Assert.Equal(new DateTime(2026, 11, 16, 8, 0, 0), sheet.Cell(5, 4).GetDateTime());   // Lagos time
            Assert.Equal("Yes", sheet.Cell(5, 5).GetString());
            Assert.Equal("Total", sheet.Cell(7, 1).GetString());
        }

        [Fact]
        public void The_CSV_file_starts_with_a_byte_order_mark_quotes_commas_and_defuses_formulas()
        {
            var bytes = ReportExporter.ToCsv(Sample(), 1);
            Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, bytes.Take(3).ToArray());
            var text = System.Text.Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
            var lines = text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
            Assert.Equal("Name,Tickets,Within time %,Raised,Escalated", lines[0]);
            Assert.StartsWith("\"'=HYPERLINK", lines[1]);
            Assert.Contains("2026-11-16 08:00", lines[1]);
            Assert.StartsWith("\"Plain, with comma\",2,,,No", lines[2]);
            Assert.StartsWith("Total,7,87.5", lines[3]);
        }

        [Fact]
        public void File_names_are_safe_and_carry_the_time_made()
        {
            var name = ReportExporter.FileName(new ReportResultDto { Title = "SLA breaches / last 30 days!" }, "xlsx", new DateTime(2026, 11, 17, 12, 5, 0, DateTimeKind.Utc), 1);
            Assert.Equal("SLA-breaches-last-30-days-20261117-1305.xlsx", name);
        }

        [Fact]
        public async Task A_Super_Admin_downloads_a_built_in_report_as_Excel_and_as_CSV_and_a_bad_format_is_refused()
        {
            var admin = await As("test.superadmin");
            var spec = ReportCatalogue.BuiltIns().First(b => b.Code == "R3").Definition;

            var xlsx = await admin.PostAsJsonAsync("/api/reports/export?format=xlsx", spec);
            Assert.Equal(HttpStatusCode.OK, xlsx.StatusCode);
            Assert.Equal(ReportExporter.XlsxType, xlsx.Content.Headers.ContentType!.MediaType);
            var bytes = await xlsx.Content.ReadAsByteArrayAsync();
            Assert.Equal((byte)'P', bytes[0]);
            Assert.Equal((byte)'K', bytes[1]);

            var csv = await admin.PostAsJsonAsync("/api/reports/export?format=csv", spec);
            Assert.Equal(HttpStatusCode.OK, csv.StatusCode);
            Assert.StartsWith("text/csv", csv.Content.Headers.ContentType!.MediaType);

            var bad = await admin.PostAsJsonAsync("/api/reports/export?format=pdf", spec);
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        }

        [Fact]
        public async Task A_requester_cannot_download_reports()
        {
            var requester = await As("test.requester");
            var response = await requester.PostAsJsonAsync("/api/reports/export?format=xlsx", new ReportSpec());
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
    }
}

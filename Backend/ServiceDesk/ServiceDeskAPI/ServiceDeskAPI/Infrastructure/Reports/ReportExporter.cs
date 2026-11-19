using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Reports
{
    /// <summary>
    /// Turns a report result into an Excel (.xlsx) or CSV file (Step 9c). Times are shown in Lagos time. Text that looks like a formula
    /// (starts with = + - @) is stored as plain text, so a ticket subject can never run as a formula in the person's spreadsheet.
    /// Excel layout: row 1 title, row 2 period and time made, row 4 headings, data from row 5, then the total row.
    /// </summary>
    public static class ReportExporter
    {
        public const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        public const string CsvType = "text/csv; charset=utf-8";

        private static string Subtitle(ReportResultDto r, int offsetHours)
        {
            var period = r.From == null && r.To == null ? "All time" : "Period: " + (r.From ?? "start") + " to " + (r.To ?? "today");
            return period + "   |   Made " + r.GeneratedAt.AddHours(offsetHours).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " (Lagos time)";
        }

        private static DateTime Local(object value, int offsetHours) => value switch
        {
            DateTime d => DateTime.SpecifyKind(d, DateTimeKind.Utc).AddHours(offsetHours),
            DateTimeOffset o => o.UtcDateTime.AddHours(offsetHours),
            _ => default
        };

        public static byte[] ToXlsx(ReportResultDto r, int offsetHours)
        {
            using var workbook = new XLWorkbook();
            var sheet = workbook.AddWorksheet("Report");
            var columns = r.Columns;
            var n = Math.Max(1, columns.Count);

            sheet.Cell(1, 1).Value = r.Title;
            sheet.Cell(1, 1).Style.Font.Bold = true;
            sheet.Cell(1, 1).Style.Font.FontSize = 14;
            sheet.Cell(2, 1).Value = Subtitle(r, offsetHours);
            sheet.Cell(2, 1).Style.Font.FontColor = XLColor.FromHtml("#555555");

            const int headerRow = 4;
            for (var c = 0; c < columns.Count; c++) sheet.Cell(headerRow, c + 1).Value = columns[c].Label;
            var header = sheet.Range(headerRow, 1, headerRow, n);
            header.Style.Font.Bold = true;
            header.Style.Font.FontColor = XLColor.White;
            header.Style.Fill.BackgroundColor = XLColor.FromHtml("#1F3A5F");
            header.Style.Alignment.WrapText = true;

            var row = headerRow;
            foreach (var values in r.Rows)
            {
                row++;
                for (var c = 0; c < columns.Count && c < values.Count; c++) WriteCell(sheet.Cell(row, c + 1), columns[c].Type, values[c], offsetHours);
            }
            var lastData = row;

            if (r.Totals != null)
            {
                row++;
                for (var c = 0; c < columns.Count && c < r.Totals.Count; c++) WriteCell(sheet.Cell(row, c + 1), columns[c].Type, r.Totals[c], offsetHours);
                var total = sheet.Range(row, 1, row, n);
                total.Style.Font.Bold = true;
                total.Style.Border.TopBorder = XLBorderStyleValues.Thin;
            }
            if (r.Truncated)
            {
                row += 2;
                sheet.Cell(row, 1).Value = "Only the first rows are shown. Narrow the filters to see the rest.";
                sheet.Cell(row, 1).Style.Font.Italic = true;
            }

            if (lastData > headerRow && columns.Count > 0) sheet.Range(headerRow, 1, lastData, n).SetAutoFilter();
            sheet.SheetView.FreezeRows(headerRow);
            for (var c = 1; c <= n; c++) sheet.Column(c).AdjustToContents(headerRow, Math.Max(lastData, headerRow));
            foreach (var column in sheet.ColumnsUsed())
            {
                if (column.Width > 60) column.Width = 60;
                if (column.Width < 12) column.Width = 12;
            }

            using var stream = new MemoryStream();
            workbook.SaveAs(stream);
            return stream.ToArray();
        }

        private static void WriteCell(IXLCell cell, string type, object? value, int offsetHours)
        {
            if (value == null) return;
            switch (type)
            {
                case "number":
                    if (value is int i) { cell.Value = i; cell.Style.NumberFormat.Format = "0"; }
                    else if (TryNumber(value, out var d)) { cell.Value = d; cell.Style.NumberFormat.Format = "0.0"; }
                    else cell.Value = value.ToString() ?? string.Empty;
                    break;
                case "percent":
                    if (TryNumber(value, out var p)) { cell.Value = p; cell.Style.NumberFormat.Format = "0.0\"%\""; }
                    else cell.Value = value.ToString() ?? string.Empty;
                    break;
                case "hours":
                    if (TryNumber(value, out var h)) { cell.Value = h; cell.Style.NumberFormat.Format = "0.0"; }
                    else cell.Value = value.ToString() ?? string.Empty;
                    break;
                case "datetime":
                    if (value is DateTime) { cell.Value = Local(value, offsetHours); cell.Style.NumberFormat.Format = "yyyy-mm-dd hh:mm"; }
                    else cell.Value = value.ToString() ?? string.Empty;
                    break;
                case "date":
                    if (DateTime.TryParseExact(value.ToString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
                    { cell.Value = day; cell.Style.NumberFormat.Format = "yyyy-mm-dd"; }
                    else cell.Value = value.ToString() ?? string.Empty;
                    break;
                case "boolean":
                    cell.Value = value is bool b ? (b ? "Yes" : "No") : value.ToString() ?? string.Empty;
                    break;
                default:
                    cell.Value = value.ToString() ?? string.Empty;   // always plain text, never a formula
                    cell.Style.NumberFormat.Format = "@";
                    break;
            }
        }

        private static bool TryNumber(object value, out double number)
        {
            switch (value)
            {
                case double d: number = d; return true;
                case int i: number = i; return true;
                case long l: number = l; return true;
                case decimal m: number = (double)m; return true;
                default: number = 0; return false;
            }
        }

        public static byte[] ToCsv(ReportResultDto r, int offsetHours)
        {
            var text = new StringBuilder();
            text.Append(string.Join(",", r.Columns.Select(c => Cell(c.Label)))).Append("\r\n");
            foreach (var values in r.Rows) text.Append(Line(r, values, offsetHours)).Append("\r\n");
            if (r.Totals != null) text.Append(Line(r, r.Totals, offsetHours)).Append("\r\n");
            var preamble = new UTF8Encoding(true).GetPreamble();
            var body = new UTF8Encoding(false).GetBytes(text.ToString());
            return preamble.Concat(body).ToArray();
        }

        private static string Line(ReportResultDto r, List<object?> values, int offsetHours)
        {
            var cells = new List<string>();
            for (var c = 0; c < r.Columns.Count; c++)
            {
                var value = c < values.Count ? values[c] : null;
                cells.Add(Cell(Format(r.Columns[c].Type, value, offsetHours)));
            }
            return string.Join(",", cells);
        }

        private static string Format(string type, object? value, int offsetHours)
        {
            if (value == null) return string.Empty;
            return value switch
            {
                bool b => b ? "Yes" : "No",
                DateTime => Local(value, offsetHours).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
                double d => d.ToString("0.##", CultureInfo.InvariantCulture),
                int i => i.ToString(CultureInfo.InvariantCulture),
                _ => value.ToString() ?? string.Empty
            };
        }

        /// <summary>Quotes a cell, and neutralises anything a spreadsheet would run as a formula.</summary>
        private static string Cell(string text)
        {
            if (text.Length > 0 && (text[0] == '=' || text[0] == '+' || text[0] == '-' || text[0] == '@' || text[0] == '\t' || text[0] == '\r'))
            {
                var isPlainNumber = double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out _);
                if (!isPlainNumber) text = "'" + text;
            }
            return text.IndexOfAny(new[] { ',', '"', '\r', '\n' }) >= 0 ? "\"" + text.Replace("\"", "\"\"") + "\"" : text;
        }

        public static string FileName(ReportResultDto r, string extension, DateTime nowUtc, int offsetHours)
        {
            var safe = new string((r.Title ?? "report").Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray()).Trim('-');
            while (safe.Contains("--")) safe = safe.Replace("--", "-");
            if (safe.Length == 0) safe = "report";
            if (safe.Length > 60) safe = safe.Substring(0, 60).Trim('-');
            return safe + "-" + nowUtc.AddHours(offsetHours).ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture) + "." + extension;
        }
    }
}

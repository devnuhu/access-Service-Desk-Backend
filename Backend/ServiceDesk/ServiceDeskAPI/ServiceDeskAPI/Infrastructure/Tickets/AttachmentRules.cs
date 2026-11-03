using System.Security.Cryptography;
using ServiceDeskAPI.Domain.Tickets;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// Attachment checks (decision of 3 Nov 2026): 0 to 6 files per ticket form or comment, each at most 1 MB, only PDF, DOCX, XLSX,
    /// CSV, JPG and PNG. The type is decided from the extension AND the file's first bytes, never from what the browser claims.
    /// Virus scanning (BRD FR-2.4) is added in the security hardening step; until then only these checks run.
    /// </summary>
    public static class AttachmentRules
    {
        public sealed record CheckedFile(string FileName, string ContentType, byte[] Data, string Sha256);

        private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
        {
            [".pdf"] = "application/pdf",
            [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            [".csv"] = "text/csv",
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".png"] = "image/png"
        };

        public const string Allowed = "PDF, DOCX, XLSX, CSV, JPG or PNG";

        /// <summary>Reads and checks the files. Returns the error message for the "files" field, or the checked files.</summary>
        public static async Task<(string? Error, List<CheckedFile> Files)> CheckAsync(IReadOnlyCollection<IFormFile>? files)
        {
            var result = new List<CheckedFile>();
            if (files == null || files.Count == 0) return (null, result);
            if (files.Count > TicketSeed.MaxFilesPerSubmission)
                return ("Attach at most " + TicketSeed.MaxFilesPerSubmission + " files.", result);

            foreach (var file in files)
            {
                var name = SafeName(file.FileName);
                if (file.Length == 0) return (name + " is empty.", result);
                if (file.Length > TicketSeed.MaxFileBytes) return (name + " is larger than 1 MB.", result);
                var extension = Path.GetExtension(name);
                if (!Types.TryGetValue(extension, out var contentType)) return (name + ": only " + Allowed + " files can be attached.", result);

                byte[] data;
                await using (var stream = file.OpenReadStream())
                using (var memory = new MemoryStream())
                {
                    await stream.CopyToAsync(memory);
                    data = memory.ToArray();
                }
                if (data.Length == 0 || data.Length > TicketSeed.MaxFileBytes) return (name + " is empty or larger than 1 MB.", result);
                if (!LooksLike(extension, data)) return (name + " is not a real " + extension.TrimStart('.').ToUpperInvariant() + " file.", result);

                result.Add(new CheckedFile(name, contentType, data, Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant()));
            }
            return (null, result);
        }

        /// <summary>The file name without any folder, control or path characters, at most 255 characters.</summary>
        public static string SafeName(string? fileName)
        {
            var name = Path.GetFileName((fileName ?? string.Empty).Replace('\\', '/'));
            var cleaned = new string(name.Where(c => !char.IsControl(c) && c != '"' && c != '/' && c != ':' && c != '*' && c != '?' && c != '<' && c != '>' && c != '|').ToArray()).Trim();
            if (string.IsNullOrWhiteSpace(cleaned)) cleaned = "file";
            if (cleaned.Length > 255)
            {
                var extension = Path.GetExtension(cleaned);
                cleaned = cleaned.Substring(0, 255 - extension.Length) + extension;
            }
            return cleaned;
        }

        private static bool LooksLike(string extension, byte[] data)
        {
            bool Starts(params byte[] signature) => data.Length >= signature.Length && data.AsSpan(0, signature.Length).SequenceEqual(signature);
            switch (extension.ToLowerInvariant())
            {
                case ".pdf": return Starts(0x25, 0x50, 0x44, 0x46, 0x2D); // %PDF-
                case ".docx":
                case ".xlsx": return Starts(0x50, 0x4B, 0x03, 0x04); // zip container
                case ".jpg":
                case ".jpeg": return Starts(0xFF, 0xD8, 0xFF);
                case ".png": return Starts(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
                case ".csv":
                    // Text only (Excel may save UTF-8 or ANSI): no NUL bytes, and not one of the binary types above
                    return Array.IndexOf(data, (byte)0) < 0 && !Starts(0x50, 0x4B, 0x03, 0x04) && !Starts(0x4D, 0x5A);
                default: return false;
            }
        }
    }
}
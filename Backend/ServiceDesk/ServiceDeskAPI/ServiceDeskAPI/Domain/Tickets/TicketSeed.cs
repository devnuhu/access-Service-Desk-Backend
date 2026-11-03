namespace ServiceDeskAPI.Domain.Tickets
{
    /// <summary>Fixed ids and limits for tickets (decisions of 3 Nov 2026).</summary>
    public static class TicketSeed
    {
        /// <summary>The one location at launch; a Super Admin adds the rest.</summary>
        public static readonly Guid HeadquartersLocationId = new("5d1a0004-0000-4000-8000-000000000001");
        public const string HeadquartersName = "HQ";

        /// <summary>Attachments per ticket form or per comment (0 to 6), each at most 1 MB.</summary>
        public const int MaxFilesPerSubmission = 6;
        public const long MaxFileBytes = 1024 * 1024;

        /// <summary>Formatted description or comment after cleaning.</summary>
        public const int MaxHtmlChars = 200_000;
        public const int MaxSubjectChars = 200;
    }
}
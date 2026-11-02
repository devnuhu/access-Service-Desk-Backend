namespace ServiceDeskAPI.Domain.Organisation
{
    /// <summary>
    /// The first department on Access Desk, seeded by migration (BRD Section 5). Further departments and units are added by a
    /// Super Admin as data. Fixed ids so the seed never changes between migrations and tests can refer to them.
    /// </summary>
    public static class OrgSeed
    {
        public static readonly Guid ContributionProcessingId = new("5d1a0002-0000-4000-8000-000000000001");
        public static readonly Guid ContributionMatchingUnitId = new("5d1a0002-0000-4000-8000-000000000011");
        public static readonly Guid RefundUnitId = new("5d1a0002-0000-4000-8000-000000000012");

        public const string ContributionProcessingCode = "CP";
        public const string ContributionMatchingCode = "CM";
        public const string RefundCode = "RF";
    }

    /// <summary>A case worker's staff category (BRD 5.4): drives escalation. Set by the structure: HeadOfUnit when the person heads the unit.</summary>
    public enum StaffCategory
    {
        Employee = 1,
        HeadOfUnit = 2
    }
}
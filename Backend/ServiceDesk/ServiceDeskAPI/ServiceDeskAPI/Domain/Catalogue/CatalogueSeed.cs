using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Domain.Catalogue
{
    /// <summary>
    /// The Contribution Processing catalogue at launch (BRD Section 7, from ISSUES_RESOLUTION.xlsx): 22 categories, 15 owned by
    /// Contribution Matching and 7 by Refund, each with a 24-hour timeline and Medium default priority. Fixed ids so the seed is stable.
    /// A Super Admin adds, renames, moves or switches off categories afterwards without code changes.
    /// </summary>
    public static class CatalogueSeed
    {
        public sealed record SeedCategory(Guid Id, Guid UnitId, string Name);

        public static readonly IReadOnlyList<SeedCategory> Categories = new List<SeedCategory>
        {
            new(new Guid("5d1a0003-0000-4000-8000-000000000001"), OrgSeed.ContributionMatchingUnitId, "Account Reconciliation"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000002"), OrgSeed.ContributionMatchingUnitId, "Accrued Rights"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000003"), OrgSeed.ContributionMatchingUnitId, "Evidence of Remittance"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000004"), OrgSeed.ContributionMatchingUnitId, "Clarification of Narration"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000005"), OrgSeed.ContributionMatchingUnitId, "Employer Narration Change"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000006"), OrgSeed.ContributionMatchingUnitId, "Period Narration Change"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000007"), OrgSeed.ContributionMatchingUnitId, "PPP Payment Confirmation"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000008"), OrgSeed.ContributionMatchingUnitId, "Missing Remittance"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000009"), OrgSeed.ContributionMatchingUnitId, "Employer Confirmation"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000010"), OrgSeed.ContributionMatchingUnitId, "Excess Remittance Confirmation"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000011"), OrgSeed.ContributionMatchingUnitId, "Fund Movement"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000012"), OrgSeed.RefundUnitId, "Transaction History Request"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000013"), OrgSeed.ContributionMatchingUnitId, "MPS to CPS"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000014"), OrgSeed.ContributionMatchingUnitId, "Schedule Submission"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000015"), OrgSeed.ContributionMatchingUnitId, "PIN Change"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000016"), OrgSeed.ContributionMatchingUnitId, "PPP Refund"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000017"), OrgSeed.RefundUnitId, "Transfer to Other PFAs"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000018"), OrgSeed.RefundUnitId, "Refund to Employers"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000019"), OrgSeed.RefundUnitId, "Correction of Invalid PINs"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000020"), OrgSeed.RefundUnitId, "Provision of Schedules for Multiple PINs Request to BA"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000021"), OrgSeed.RefundUnitId, "Query Resolution"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000022"), OrgSeed.RefundUnitId, "TCF Reconciliation"),
        };
    }
}
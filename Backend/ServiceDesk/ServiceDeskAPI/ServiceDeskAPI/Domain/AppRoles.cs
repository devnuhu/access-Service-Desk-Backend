namespace ServiceDeskAPI.Domain
{
    /// <summary>
    /// The five roles of BRD Section 4. A person can hold several at once (for example Requester and CaseWorker).
    /// The ids are fixed so the seed data never changes between migrations.
    /// </summary>
    public static class AppRoles
    {
        public const string Requester = "Requester";
        public const string CaseWorker = "CaseWorker";
        public const string HeadOfUnit = "HeadOfUnit";
        public const string HOD = "HOD";
        public const string SuperAdmin = "SuperAdmin";

        public static readonly Guid RequesterId = new("5d1a0001-0000-4000-8000-000000000001");
        public static readonly Guid CaseWorkerId = new("5d1a0001-0000-4000-8000-000000000002");
        public static readonly Guid HeadOfUnitId = new("5d1a0001-0000-4000-8000-000000000003");
        public static readonly Guid HODId = new("5d1a0001-0000-4000-8000-000000000004");
        public static readonly Guid SuperAdminId = new("5d1a0001-0000-4000-8000-000000000005");

        public static readonly IReadOnlyList<string> All = new[] { Requester, CaseWorker, HeadOfUnit, HOD, SuperAdmin };
    }
}
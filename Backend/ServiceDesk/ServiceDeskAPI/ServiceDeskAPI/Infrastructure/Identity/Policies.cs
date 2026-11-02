using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// Authorization policies (BRD Section 4). Every endpoint names one of these, or [Authorize] for any signed-in staff member.
    /// SuperAdmin passes every policy. HOD oversees but does not work tickets, so HOD is not in Case_Work.
    /// </summary>
    public static class Policies
    {
        public const string SuperAdminOnly = "Super_Admin_Only";
        public const string UnitManagement = "Unit_Management";
        public const string DepartmentOversight = "Department_Oversight";
        public const string Oversight = "Oversight";
        public const string CaseWork = "Case_Work";

        public static readonly IReadOnlyDictionary<string, string[]> Roles = new Dictionary<string, string[]>
        {
            [SuperAdminOnly] = new[] { AppRoles.SuperAdmin },
            [UnitManagement] = new[] { AppRoles.HeadOfUnit, AppRoles.SuperAdmin },
            [DepartmentOversight] = new[] { AppRoles.HOD, AppRoles.SuperAdmin },
            [Oversight] = new[] { AppRoles.HeadOfUnit, AppRoles.HOD, AppRoles.SuperAdmin },
            [CaseWork] = new[] { AppRoles.CaseWorker, AppRoles.HeadOfUnit, AppRoles.SuperAdmin }
        };

        public static void Register(AuthorizationOptions options)
        {
            options.DefaultPolicy = new AuthorizationPolicyBuilder(JwtBearerDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .Build();

            foreach (var (name, roles) in Roles)
            {
                options.AddPolicy(name, policy => policy
                    .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
                    .RequireAuthenticatedUser()
                    .RequireRole(roles));
            }
        }
    }
}
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using Xunit;

namespace ServiceDeskAPI.Tests.Auth
{
    /// <summary>Step 1a: the role policies match BRD Section 4.</summary>
    public class PolicyTests
    {
        private static string[] AllowedRoles(string policyName)
        {
            var options = new AuthorizationOptions();
            Policies.Register(options);
            var policy = options.GetPolicy(policyName);
            Assert.NotNull(policy);
            return Assert.Single(policy!.Requirements.OfType<RolesAuthorizationRequirement>()).AllowedRoles.OrderBy(r => r).ToArray();
        }

        [Fact]
        public void Super_Admin_Only_is_SuperAdmin_alone() =>
            Assert.Equal(new[] { AppRoles.SuperAdmin }, AllowedRoles(Policies.SuperAdminOnly));

        [Fact]
        public void SuperAdmin_passes_every_policy()
        {
            foreach (var name in Policies.Roles.Keys)
                Assert.Contains(AppRoles.SuperAdmin, AllowedRoles(name));
        }

        [Fact]
        public void HOD_oversees_but_does_not_work_tickets()
        {
            Assert.Contains(AppRoles.HOD, AllowedRoles(Policies.Oversight));
            Assert.DoesNotContain(AppRoles.HOD, AllowedRoles(Policies.CaseWork));
        }

        [Fact]
        public void A_Requester_alone_passes_no_named_policy()
        {
            foreach (var name in Policies.Roles.Keys)
                Assert.DoesNotContain(AppRoles.Requester, AllowedRoles(name));
        }
    }
}
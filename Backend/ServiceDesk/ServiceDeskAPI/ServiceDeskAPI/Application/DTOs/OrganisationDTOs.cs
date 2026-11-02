using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A person shown next to a structure role (head, deputy, HOD).</summary>
    public record PersonRefDto(Guid UserId, string UserName, string? FullName, string? Email);

    public class UnitDto
    {
        public Guid Id { get; set; }
        public Guid DepartmentId { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; }
        public PersonRefDto? Head { get; set; }
        public PersonRefDto? Deputy { get; set; }
        public int MemberCount { get; set; }
    }

    public class DepartmentDto
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; }
        public PersonRefDto? Hod { get; set; }
        public List<UnitDto> Units { get; set; } = new();
    }

    public class UnitMemberDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public string? Email { get; set; }
        public string? StaffNo { get; set; }
        public StaffCategory StaffCategory { get; set; }
        public bool IsHead { get; set; }
        public bool IsDeputy { get; set; }
        public bool AccountActive { get; set; }
        public DateTime JoinedAt { get; set; }
        public DateTime? LastAssignedAt { get; set; }
    }

    public class CreateDepartmentRequest
    {
        /// <summary>2 to 10 capital letters, digits or dashes, for example CP. Cannot be changed later.</summary>
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
    }

    public class CreateUnitRequest
    {
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
    }

    /// <summary>Change the name and/or switch on or off. Leave a field out (null) to keep it.</summary>
    public class UpdateOrgItemRequest
    {
        public string? Name { get; set; }
        public bool? IsActive { get; set; }
    }

    /// <summary>The person for a structure role, or null to clear it.</summary>
    public class SetPersonRequest
    {
        public Guid? UserId { get; set; }
    }

    public class AddUnitMemberRequest
    {
        public Guid UserId { get; set; }
        public string? StaffNo { get; set; }
    }

    /// <summary>What the signed-in person does in the structure. The web app builds module menus from this.</summary>
    public class MyOrganisationDto
    {
        public List<MyDepartmentDto> Departments { get; set; } = new();
    }

    public class MyDepartmentDto
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsHod { get; set; }
        public List<MyUnitDto> Units { get; set; } = new();
    }

    public class MyUnitDto
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsHead { get; set; }
        public bool IsDeputy { get; set; }
        public bool IsMember { get; set; }
    }

    /// <summary>Active departments that receive tickets, with their active units (for any signed-in person).</summary>
    public record OrgDepartmentDto(Guid Id, string Code, string Name, List<OrgUnitDto> Units);

    public record OrgUnitDto(Guid Id, string Code, string Name);
}
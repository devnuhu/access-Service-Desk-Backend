using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace ServiceDeskAPI.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Organisation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Departments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    HodUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Departments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Departments_Users_HodUserId",
                        column: x => x.HodUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Units",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DepartmentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    HeadUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    DeputyHeadUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Units", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Units_Departments_DepartmentId",
                        column: x => x.DepartmentId,
                        principalTable: "Departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Units_Users_DeputyHeadUserId",
                        column: x => x.DeputyHeadUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Units_Users_HeadUserId",
                        column: x => x.HeadUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "UnitMembers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UnitId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    StaffCategory = table.Column<int>(type: "int", nullable: false),
                    StaffNo = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    LastAssignedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    JoinedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    AddedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LeftAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    RemovedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UnitMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UnitMembers_Units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "Units",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UnitMembers_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "Departments",
                columns: new[] { "Id", "Code", "CreatedAt", "CreatedByUserId", "HodUserId", "IsActive", "Name", "UpdatedAt", "UpdatedByUserId" },
                values: new object[] { new Guid("5d1a0002-0000-4000-8000-000000000001"), "CP", new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, null, true, "Contribution Processing", null, null });

            migrationBuilder.InsertData(
                table: "Units",
                columns: new[] { "Id", "Code", "CreatedAt", "CreatedByUserId", "DepartmentId", "DeputyHeadUserId", "HeadUserId", "IsActive", "Name", "UpdatedAt", "UpdatedByUserId" },
                values: new object[,]
                {
                    { new Guid("5d1a0002-0000-4000-8000-000000000011"), "CM", new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, null, true, "Contribution Matching", null, null },
                    { new Guid("5d1a0002-0000-4000-8000-000000000012"), "RF", new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, null, true, "Refund", null, null }
                });

            migrationBuilder.CreateIndex(
                name: "IX_Departments_Code",
                table: "Departments",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Departments_HodUserId",
                table: "Departments",
                column: "HodUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Departments_Name",
                table: "Departments",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UnitMembers_UnitId_UserId_Active",
                table: "UnitMembers",
                columns: new[] { "UnitId", "UserId" },
                unique: true,
                filter: "[IsActive] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_UnitMembers_UserId",
                table: "UnitMembers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Units_DepartmentId_Code",
                table: "Units",
                columns: new[] { "DepartmentId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Units_DepartmentId_Name",
                table: "Units",
                columns: new[] { "DepartmentId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Units_DeputyHeadUserId",
                table: "Units",
                column: "DeputyHeadUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Units_HeadUserId",
                table: "Units",
                column: "HeadUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UnitMembers");

            migrationBuilder.DropTable(
                name: "Units");

            migrationBuilder.DropTable(
                name: "Departments");
        }
    }
}

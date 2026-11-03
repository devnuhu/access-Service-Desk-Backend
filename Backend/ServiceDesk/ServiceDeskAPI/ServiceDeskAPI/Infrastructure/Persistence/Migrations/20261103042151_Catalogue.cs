using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace ServiceDeskAPI.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Catalogue : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Categories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DepartmentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UnitId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    TimelineHours = table.Column<int>(type: "int", nullable: false),
                    DefaultPriority = table.Column<int>(type: "int", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Categories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Categories_Departments_DepartmentId",
                        column: x => x.DepartmentId,
                        principalTable: "Departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Categories_Units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "Units",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CategorySkills",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CategoryId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    AddedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    AddedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    RemovedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    RemovedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CategorySkills", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CategorySkills_Categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "Categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CategorySkills_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "Categories",
                columns: new[] { "Id", "CreatedAt", "CreatedByUserId", "DefaultPriority", "DepartmentId", "Description", "IsActive", "Name", "SortOrder", "TimelineHours", "UnitId", "UpdatedAt", "UpdatedByUserId" },
                values: new object[,]
                {
                    { new Guid("5d1a0003-0000-4000-8000-000000000001"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Account Reconciliation", 1, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000002"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Accrued Rights", 2, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000003"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Evidence of Remittance", 3, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000004"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Clarification of Narration", 4, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000005"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Employer Narration Change", 5, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000006"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Period Narration Change", 6, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000007"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "PPP Payment Confirmation", 7, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000008"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Missing Remittance", 8, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000009"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Employer Confirmation", 9, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000010"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Excess Remittance Confirmation", 10, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000011"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Fund Movement", 11, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000012"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Transaction History Request", 12, 24, new Guid("5d1a0002-0000-4000-8000-000000000012"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000013"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "MPS to CPS", 13, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000014"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Schedule Submission", 14, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000015"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "PIN Change", 15, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000016"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "PPP Refund", 16, 24, new Guid("5d1a0002-0000-4000-8000-000000000011"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000017"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Transfer to Other PFAs", 17, 24, new Guid("5d1a0002-0000-4000-8000-000000000012"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000018"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Refund to Employers", 18, 24, new Guid("5d1a0002-0000-4000-8000-000000000012"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000019"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Correction of Invalid PINs", 19, 24, new Guid("5d1a0002-0000-4000-8000-000000000012"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000020"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Provision of Schedules for Multiple PINs Request to BA", 20, 24, new Guid("5d1a0002-0000-4000-8000-000000000012"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000021"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "Query Resolution", 21, 24, new Guid("5d1a0002-0000-4000-8000-000000000012"), null, null },
                    { new Guid("5d1a0003-0000-4000-8000-000000000022"), new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), null, 2, new Guid("5d1a0002-0000-4000-8000-000000000001"), null, true, "TCF Reconciliation", 22, 24, new Guid("5d1a0002-0000-4000-8000-000000000012"), null, null }
                });

            migrationBuilder.CreateIndex(
                name: "IX_Categories_DepartmentId_Name",
                table: "Categories",
                columns: new[] { "DepartmentId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Categories_UnitId",
                table: "Categories",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_CategorySkills_CategoryId_UserId_Active",
                table: "CategorySkills",
                columns: new[] { "CategoryId", "UserId" },
                unique: true,
                filter: "[IsActive] = 1");

            migrationBuilder.CreateIndex(
                name: "IX_CategorySkills_UserId",
                table: "CategorySkills",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CategorySkills");

            migrationBuilder.DropTable(
                name: "Categories");
        }
    }
}

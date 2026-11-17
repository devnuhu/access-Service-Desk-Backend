using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceDeskAPI.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DepartmentAdmin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AdminUserId",
                table: "Departments",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.UpdateData(
                table: "Departments",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0002-0000-4000-8000-000000000001"),
                column: "AdminUserId",
                value: null);

            migrationBuilder.InsertData(
                table: "Roles",
                columns: new[] { "Id", "ConcurrencyStamp", "CreatedAt", "Description", "Name", "NormalizedName" },
                values: new object[] { new Guid("5d1a0001-0000-4000-8000-000000000006"), "5d1a0001-0000-4000-8000-000000000006", new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), "A unit head named by the Super Admin who also sees and administers the whole department: every unit, every ticket, reassignment across units.", "DepartmentAdmin", "DEPARTMENTADMIN" });

            migrationBuilder.CreateIndex(
                name: "IX_Departments_AdminUserId",
                table: "Departments",
                column: "AdminUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Departments_Users_AdminUserId",
                table: "Departments",
                column: "AdminUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Departments_Users_AdminUserId",
                table: "Departments");

            migrationBuilder.DropIndex(
                name: "IX_Departments_AdminUserId",
                table: "Departments");

            migrationBuilder.DeleteData(
                table: "Roles",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0001-0000-4000-8000-000000000006"));

            migrationBuilder.DropColumn(
                name: "AdminUserId",
                table: "Departments");
        }
    }
}

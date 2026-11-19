using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceDeskAPI.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SavedReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SavedReports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    DefinitionJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Share = table.Column<int>(type: "int", nullable: false),
                    ShareUnitId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ShareDepartmentId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ShareRoles = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedReports", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SavedReports_OwnerUserId_Name",
                table: "SavedReports",
                columns: new[] { "OwnerUserId", "Name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SavedReports");
        }
    }
}

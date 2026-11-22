using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceDeskAPI.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PriorityMatrix : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Impact",
                table: "Tickets",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Urgency",
                table: "Tickets",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PriorityMatrix",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Impact = table.Column<int>(type: "int", nullable: false),
                    Urgency = table.Column<int>(type: "int", nullable: false),
                    Priority = table.Column<int>(type: "int", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PriorityMatrix", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PriorityMatrix_Impact_Urgency",
                table: "PriorityMatrix",
                columns: new[] { "Impact", "Urgency" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PriorityMatrix");

            migrationBuilder.DropColumn(
                name: "Impact",
                table: "Tickets");

            migrationBuilder.DropColumn(
                name: "Urgency",
                table: "Tickets");
        }
    }
}

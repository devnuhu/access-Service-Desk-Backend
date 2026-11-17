using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ServiceDeskAPI.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RemoveUnitDeputy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Units_Users_DeputyHeadUserId",
                table: "Units");

            migrationBuilder.DropIndex(
                name: "IX_Units_DeputyHeadUserId",
                table: "Units");

            migrationBuilder.DropColumn(
                name: "DeputyHeadUserId",
                table: "Units");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DeputyHeadUserId",
                table: "Units",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.UpdateData(
                table: "Units",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0002-0000-4000-8000-000000000011"),
                column: "DeputyHeadUserId",
                value: null);

            migrationBuilder.UpdateData(
                table: "Units",
                keyColumn: "Id",
                keyValue: new Guid("5d1a0002-0000-4000-8000-000000000012"),
                column: "DeputyHeadUserId",
                value: null);

            migrationBuilder.CreateIndex(
                name: "IX_Units_DeputyHeadUserId",
                table: "Units",
                column: "DeputyHeadUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Units_Users_DeputyHeadUserId",
                table: "Units",
                column: "DeputyHeadUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}

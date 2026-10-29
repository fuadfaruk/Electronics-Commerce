using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ElectroApi.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class OwnerOrderNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OwnerOrderNotifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "char(36)", nullable: false),
                    OrderId = table.Column<Guid>(type: "char(36)", nullable: false),
                    ProtectedPayload = table.Column<string>(type: "longtext", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    PartCount = table.Column<int>(type: "int", nullable: false),
                    CurrentPart = table.Column<int>(type: "int", nullable: false),
                    Attempts = table.Column<int>(type: "int", nullable: false),
                    LeaseId = table.Column<Guid>(type: "char(36)", nullable: true),
                    LeaseUntil = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    FailedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    LastMessageId = table.Column<long>(type: "bigint", nullable: true),
                    FailureCode = table.Column<string>(type: "varchar(40)", maxLength: 40, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OwnerOrderNotifications", x => x.Id);
                    table.CheckConstraint("CK_OwnerNotification_Progress", "PartCount > 0 AND CurrentPart >= 0 AND CurrentPart <= PartCount AND Attempts >= 0 AND Attempts <= 10");
                    table.ForeignKey(
                        name: "FK_OwnerOrderNotifications_Orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                })
                .Annotation("MySQL:Charset", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_OwnerOrderNotifications_CompletedAt_FailedAt_CreatedAt",
                table: "OwnerOrderNotifications",
                columns: new[] { "CompletedAt", "FailedAt", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_OwnerOrderNotifications_CompletedAt_FailedAt_NextAttemptAt_L~",
                table: "OwnerOrderNotifications",
                columns: new[] { "CompletedAt", "FailedAt", "NextAttemptAt", "LeaseUntil" });

            migrationBuilder.CreateIndex(
                name: "IX_OwnerOrderNotifications_OrderId",
                table: "OwnerOrderNotifications",
                column: "OrderId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OwnerOrderNotifications");
        }
    }
}

ALTER TABLE "notification_outbox" RENAME TO "notifications";--> statement-breakpoint
ALTER TABLE "notifications" RENAME CONSTRAINT "notification_outbox_user_id_users_id_fk" TO "notifications_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "attempts";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "available_at";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "delivered_at";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "last_error";--> statement-breakpoint
DROP TABLE "devices";

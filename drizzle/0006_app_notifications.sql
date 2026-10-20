DROP INDEX "notification_outbox_delivery_idx";--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_idx" ON "notification_outbox" USING btree ("user_id","read_at","created_at");
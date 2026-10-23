ALTER TABLE "tasks" ADD COLUMN "recurrence" varchar(10);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_day" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "series_id" uuid;

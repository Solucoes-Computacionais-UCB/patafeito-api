ALTER TABLE "tasks" ADD COLUMN "category" varchar(20) DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "estimated_minutes" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "kind" varchar(10) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_user_kind_created_idx" ON "tasks" USING btree ("user_id","kind","created_at");
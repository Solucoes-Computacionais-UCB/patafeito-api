ALTER TABLE "focus_sessions" ADD COLUMN "mode" varchar(12) DEFAULT 'pomodoro' NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "users" ADD COLUMN "daily_goal_xp" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" varchar(40) DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "overdue_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "inactivity_penalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "overdue_processed_at" timestamp with time zone;--> statement-breakpoint
-- Pets existentes começam a contar a inatividade (RN11) a partir desta migração, sem punição retroativa.
UPDATE "pets" SET "last_activity_at" = now() WHERE "last_activity_at" IS NULL;

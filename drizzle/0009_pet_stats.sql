ALTER TABLE "pets" RENAME COLUMN "health" TO "energy";--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "stats_updated_at" timestamp with time zone DEFAULT now() NOT NULL;

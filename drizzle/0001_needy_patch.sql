CREATE TABLE "reward_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_id" uuid NOT NULL,
	"xp_delta" integer NOT NULL,
	"coin_delta" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_ledger_source_user_unique" UNIQUE("source_type","source_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reward_ledger_user_occurred_idx" ON "reward_ledger" USING btree ("user_id","occurred_at");
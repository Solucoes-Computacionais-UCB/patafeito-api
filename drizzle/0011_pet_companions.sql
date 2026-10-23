CREATE TABLE "pet_companions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pet_id" uuid NOT NULL,
	"species_id" varchar(40) NOT NULL,
	"name" varchar(15) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pet_companions" ADD CONSTRAINT "pet_companions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_companions" ADD CONSTRAINT "pet_companions_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pet_companions_pet_started_idx" ON "pet_companions" USING btree ("pet_id","started_at");--> statement-breakpoint
-- Pets existentes começam o histórico na data em que foram criados.
INSERT INTO "pet_companions" ("user_id", "pet_id", "species_id", "name", "started_at") SELECT "user_id", "id", "species_id", "name", "created_at" FROM "pets";

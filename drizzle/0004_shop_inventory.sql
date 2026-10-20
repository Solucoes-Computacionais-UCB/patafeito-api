CREATE TABLE "shop_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" varchar(60) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(300) NOT NULL,
	"slot" varchar(30) NOT NULL,
	"price_coins" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_items_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"equipped" boolean DEFAULT false NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_user_item_unique" UNIQUE("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "shop_items" ("sku", "name", "description", "slot", "price_coins") VALUES
	('bandana-azul', 'Bandana Azul', 'Uma bandana azul para o seu pet.', 'accessory', 10),
	('oculos-redondos', 'Óculos Redondos', 'Óculos estilosos para momentos produtivos.', 'accessory', 25),
	('laco-dourado', 'Laço Dourado', 'Um laço especial para grandes conquistas.', 'accessory', 50);
--> statement-breakpoint
CREATE INDEX "inventory_user_equipped_idx" ON "inventory" USING btree ("user_id","equipped");

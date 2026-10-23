CREATE TABLE "active_boosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"effect" varchar(30) NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"uses_left" integer,
	"protected_date" varchar(10)
);
--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "consumable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "effect" jsonb DEFAULT '{"type":"none"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "active_boosts" ADD CONSTRAINT "active_boosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_boosts" ADD CONSTRAINT "active_boosts_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "active_boosts_user_effect_idx" ON "active_boosts" USING btree ("user_id","effect");--> statement-breakpoint
-- Acessórios ficam fora da loja até terem arte encaixada nos patos.
UPDATE "shop_items" SET "active" = false WHERE "slot" = 'accessory';--> statement-breakpoint
INSERT INTO "shop_items" ("sku", "name", "description", "slot", "price_coins", "consumable", "effect", "sort_order") VALUES
	('food-bread', 'Pão de forma', 'Simples e honesto. +20 de saciedade.', 'food', 3, true, '{"type":"stats","hunger":20}', 10),
	('food-corn', 'Milho', 'Petisco clássico de pato. +25 de saciedade e +2 de felicidade.', 'food', 4, true, '{"type":"stats","hunger":25,"happiness":2}', 20),
	('food-lettuce', 'Alface', 'Leve e fresquinha. +15 de saciedade, +5 de energia e +3 de felicidade.', 'food', 4, true, '{"type":"stats","hunger":15,"energy":5,"happiness":3}', 30),
	('food-watermelon', 'Melancia', 'Refrescante. +25 de saciedade, +10 de felicidade e +5 de energia.', 'food', 6, true, '{"type":"stats","hunger":25,"happiness":10,"energy":5}', 40),
	('food-fish', 'Peixe', 'Refeição de verdade. +45 de saciedade e +5 de felicidade.', 'food', 8, true, '{"type":"stats","hunger":45,"happiness":5}', 50),
	('food-cupcake', 'Cupcake', 'Para comemorar. +30 de saciedade e +20 de felicidade.', 'food', 10, true, '{"type":"stats","hunger":30,"happiness":20}', 60),
	('power-energy-coffee', 'Café energético', 'Recarrega o pato na hora. +40 de energia e +5 de felicidade.', 'power', 8, true, '{"type":"stats","energy":40,"happiness":5}', 110),
	('power-focus-hourglass', 'Ampulheta do foco', 'O próximo ciclo de foco concluído vale o dobro de XP e moedas.', 'power', 12, true, '{"type":"focus_double"}', 120),
	('power-lucky-clover', 'Trevo da sorte', 'Moedas em dobro em tarefas e ciclos de foco por 2 horas.', 'power', 15, true, '{"type":"double_coins","hours":2}', 130),
	('power-double-xp', 'Poção de XP', 'XP em dobro em tarefas e ciclos de foco por 2 horas.', 'power', 20, true, '{"type":"double_xp","hours":2}', 140),
	('power-streak-shield', 'Escudo da sequência', 'Use num dia sem tarefas: hoje conta para a sua sequência.', 'power', 25, true, '{"type":"streak_shield"}', 150),
	('scene-lago', 'Lago', 'Uma tarde tranquila à beira do lago.', 'background', 15, false, '{"type":"background"}', 210),
	('scene-biblioteca', 'Biblioteca', 'Estantes, tapete e luz de leitura.', 'background', 30, false, '{"type":"background"}', 220),
	('scene-cafe', 'Café', 'Um cantinho quente para focar.', 'background', 30, false, '{"type":"background"}', 230),
	('scene-praia', 'Praia', 'Areia, conchas e pôr do sol.', 'background', 40, false, '{"type":"background"}', 240),
	('scene-noite', 'Noite estrelada', 'Lua, estrelas e vaga-lumes.', 'background', 40, false, '{"type":"background"}', 250);

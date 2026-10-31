ALTER TABLE "shop_items" ADD COLUMN "min_level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- RN12: níveis mínimos. Comidas e o primeiro cenário ficam livres para quem está começando.
UPDATE "shop_items" SET "min_level" = 2 WHERE "sku" IN ('power-lucky-clover', 'bandana-azul');--> statement-breakpoint
UPDATE "shop_items" SET "min_level" = 3 WHERE "sku" IN ('power-double-xp', 'scene-praia');--> statement-breakpoint
UPDATE "shop_items" SET "min_level" = 4 WHERE "sku" IN ('power-streak-shield', 'oculos-redondos');--> statement-breakpoint
UPDATE "shop_items" SET "min_level" = 5 WHERE "sku" = 'scene-noite';--> statement-breakpoint
UPDATE "shop_items" SET "min_level" = 6 WHERE "sku" = 'laco-dourado';

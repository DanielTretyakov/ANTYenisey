-- Население города — для порядка подсказок в поиске города на стартовой.
-- Сам справочник (все города РФ) заливает сид: prisma/seed-cities.ts.

ALTER TABLE "City" ADD COLUMN "population" INTEGER;

-- Ограничение — то же, что в разделе 25 constraints.sql.
ALTER TABLE "City"
  ADD CONSTRAINT "City_population_sane"
  CHECK ("population" IS NULL OR "population" > 0);

-- Поиск идёт по началу названия без учёта регистра: индекс по lower(name)
-- с text_pattern_ops обслуживает LIKE 'крас%'.
CREATE INDEX "City_name_lower_idx" ON "City" (lower("name") text_pattern_ops);

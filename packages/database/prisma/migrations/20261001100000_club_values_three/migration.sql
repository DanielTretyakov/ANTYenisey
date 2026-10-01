-- Ключевых ценностей клуба — не больше трёх (решение владельца от 01.10.2026).
-- Клубы, у которых их было больше, сохраняют первые три: порядок задаёт клуб,
-- и первыми он ставит главное.
UPDATE "Tenant"
   SET "values" = (SELECT jsonb_agg(item ORDER BY position)
                     FROM jsonb_array_elements("values") WITH ORDINALITY AS t(item, position)
                    WHERE position <= 3)
 WHERE "values" IS NOT NULL
   AND jsonb_array_length("values") > 3;

ALTER TABLE "Tenant" DROP CONSTRAINT "Tenant_values_sane";

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_values_sane"
  CHECK ("values" IS NULL OR (jsonb_typeof("values") = 'array' AND jsonb_array_length("values") BETWEEN 1 AND 3));

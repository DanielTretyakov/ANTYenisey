-- Зал продажи абонемента.
--
-- До этой миграции срок считался по поясу ПЕРВОГО зала клуба, а продажа
-- показывалась в деньгах дня у каждого зала одинаково. У клуба с залами в
-- разных регионах и то и другое неверно: «до конца последнего дня» наступает в
-- разное время, а выручку стойки нельзя показывать дважды.
--
-- Решение владельца от 20.09.2026: считать по залу продажи.

ALTER TABLE "Subscription" ADD COLUMN "soldAtHallId" TEXT;

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_soldAtHallId_tenantId_fkey"
  FOREIGN KEY ("soldAtHallId", "tenantId") REFERENCES "Hall"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Проданным раньше проставляется тот самый первый зал клуба, по которому их
-- срок и посчитан: иначе они пропали бы из денег дня совсем.
UPDATE "Subscription" AS s
SET "soldAtHallId" = (
  SELECT h."id" FROM "Hall" AS h
  WHERE h."tenantId" = s."tenantId"
  ORDER BY h."createdAt" ASC
  LIMIT 1
)
WHERE s."soldAtHallId" IS NULL;

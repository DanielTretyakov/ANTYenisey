-- Страница клуба: ценности, соцсети, проверенный адрес зала, скрытые тренеры
-- (решения владельца от 25.09.2026). Ограничения — те же, что в разделе 27
-- constraints.sql.

ALTER TABLE "Tenant" ADD COLUMN "values" JSONB,
ADD COLUMN "vkUrl" TEXT,
ADD COLUMN "maxUrl" TEXT;

ALTER TABLE "Hall" ADD COLUMN "addressFiasId" TEXT,
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;

ALTER TABLE "TenantMembership" ADD COLUMN "coachHidden" BOOLEAN NOT NULL DEFAULT false;

-- Ценности — массив не длиннее шести. Что внутри пункта, решает
-- `parseClubValues`: база Json не разбирает.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_values_sane"
  CHECK ("values" IS NULL OR (jsonb_typeof("values") = 'array' AND jsonb_array_length("values") BETWEEN 1 AND 6));

-- Соцсети — только https и только свой домен: адрес уходит в ссылку на
-- открытой странице клуба.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_vk_url_sane"
  CHECK ("vkUrl" IS NULL OR (char_length("vkUrl") <= 200 AND "vkUrl" ~ '^https://vk\.(com|ru)/[A-Za-z0-9_.]+$'));

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_max_url_sane"
  CHECK ("maxUrl" IS NULL OR (char_length("maxUrl") <= 200 AND "maxUrl" ~ '^https://max\.ru/[A-Za-z0-9_./-]+$'));

-- Адрес зала — настоящий: строка и код ФИАС из подсказки DaData вместе.
-- NOT VALID: залы, заведённые до 25.09.2026, адреса могут не иметь, пока их
-- не правили; новый зал и любая правка старого без адреса не пройдут. Когда
-- на стенде адреса заполнят — VALIDATE CONSTRAINT и NOT NULL миграцией.
ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_address_verified"
  CHECK (
    "address" IS NOT NULL AND btrim("address") <> '' AND char_length("address") <= 300
    AND "addressFiasId" IS NOT NULL
    AND ("latitude" IS NULL) = ("longitude" IS NULL)
    AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))
  ) NOT VALID;

-- Скрыть со страницы клуба можно только тренера; смена роли сбрасывает флаг
-- вместе с местом в списке.
ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_coach_hidden_only_coach"
  CHECK ("coachHidden" = false OR "role" = 'COACH');

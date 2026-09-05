-- Платформенный слой над клубами (ТЗ → «Платформа и клубы: единый аккаунт»,
-- «Профиль клуба»).
--
-- Что происходит:
--
--   1. Появляется справочник городов. Город указывается и у клуба, и у зала:
--      у клуба «основной», для карточки, у зала фактический. Поиск по городу
--      находит клуб при совпадении любого из них.
--   2. ЧАСОВОЙ ПОЯС ПЕРЕЕЗЖАЕТ С КЛУБА НА ЗАЛ. Залы одной организации бывают
--      в разных регионах, и общий на клуб пояс сдвинул бы в одном из них
--      границы операционного дня и порог «за час до начала», от которого
--      считаются деньги.
--   3. Появляется UserClub — «мои клубы»: избранное и заявленная
--      принадлежность одновременно, не более трёх на человека.
--   4. У клуба появляется оформление: логотип и фирменный цвет.
--
-- Данные СОХРАНЯЮТСЯ. Пояс не сбрасывается в умолчание, а копируется каждому
-- залу из его клуба: сброс выглядел бы как работающее приложение и разошёлся
-- бы с реальностью ровно на час.
--
-- Миграция написана руками: prisma migrate видит только разницу схем и на
-- месте переноса пояса оставил бы DROP COLUMN с потерей значения.

-- ---------------------------------------------------------------------------
-- A. Справочник городов
-- ---------------------------------------------------------------------------

CREATE TABLE "City" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "region"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- Уникальна пара, а не одно название: одноимённые города в разных регионах
-- законны («Железногорск» есть и в Красноярском крае, и в Курской области),
-- а два «Красноярска» в одном регионе — нет.
--
-- NULLS NOT DISTINCT обязателен: без него два города с пустым регионом и
-- одинаковым названием прошли бы — в Postgres NULL не равен NULL.
CREATE UNIQUE INDEX "City_name_region_key"
  ON "City" ("name", "region") NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------------
-- B. Город и оформление клуба
-- ---------------------------------------------------------------------------

ALTER TABLE "Tenant" ADD COLUMN "cityId"      TEXT;
ALTER TABLE "Tenant" ADD COLUMN "logoUrl"     TEXT;
ALTER TABLE "Tenant" ADD COLUMN "accentColor" TEXT;

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Tenant_cityId_idx" ON "Tenant" ("cityId");

-- Фирменный цвет уезжает прямо в CSS-переменную страницы клуба: мусор в нём
-- означал бы сломанную вёрстку, а не пустое поле.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_accent_color_format"
  CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9a-fA-F]{6}$');

-- ---------------------------------------------------------------------------
-- C. Часовой пояс, город и адрес зала
-- ---------------------------------------------------------------------------

ALTER TABLE "Hall" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Krasnoyarsk';
ALTER TABLE "Hall" ADD COLUMN "cityId"   TEXT;
ALTER TABLE "Hall" ADD COLUMN "address"  TEXT;

-- Перенос значения, а не сброс в умолчание. Клуб во Владивостоке после сброса
-- продолжил бы работать — просто на семь часов мимо.
UPDATE "Hall" AS h
   SET "timezone" = t."timezone"
  FROM "Tenant" AS t
 WHERE h."tenantId" = t."id";

ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Hall_cityId_idx" ON "Hall" ("cityId");

-- Пояс клуба снимается только теперь, когда он скопирован во все залы.
ALTER TABLE "Tenant" DROP COLUMN "timezone";

-- ---------------------------------------------------------------------------
-- D. «Мои клубы»
-- ---------------------------------------------------------------------------

CREATE TABLE "UserClub" (
  "userId"    TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "slot"      INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserClub_pkey" PRIMARY KEY ("userId", "tenantId")
);

ALTER TABLE "UserClub"
  ADD CONSTRAINT "UserClub_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserClub"
  ADD CONSTRAINT "UserClub_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "UserClub_tenantId_idx" ON "UserClub" ("tenantId");

-- Предел «не больше трёх клубов» выражен структурой, а не триггером: слот
-- уникален в пределах человека, а набор слотов ограничен тремя. Вместе это
-- означает, что четвёртый клуб физически некуда положить.
--
-- Проверкой «а сколько у него уже есть?» в сервисе это не заменяется: два
-- параллельных запроса оба прочитают «два клуба» и оба вставят третий с
-- четвёртым. Арбитром должна быть база — как и с двойным бронированием стола.
CREATE UNIQUE INDEX "UserClub_userId_slot_key" ON "UserClub" ("userId", "slot");

ALTER TABLE "UserClub"
  ADD CONSTRAINT "UserClub_slot_range"
  CHECK ("slot" BETWEEN 1 AND 3);

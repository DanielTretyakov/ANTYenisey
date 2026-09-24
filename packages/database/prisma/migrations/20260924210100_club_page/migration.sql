-- Страница клуба: описание и баннер (решение владельца от 24.09.2026).
--
-- Баннер — файл, принадлежащий КЛУБУ, а не человеку: загрузившего
-- администратора могут уволить, а баннер останется. Поэтому у StoredFile
-- второй владелец, и владелец у файла ровно один.

ALTER TABLE "StoredFile" ADD COLUMN "ownerTenantId" TEXT,
ALTER COLUMN "ownerUserId" DROP NOT NULL;

ALTER TABLE "TenantMembership" ADD COLUMN "coachListOrder" INTEGER;

ALTER TABLE "Tenant" ADD COLUMN "bannerFileId" TEXT,
ADD COLUMN "description" TEXT;

CREATE INDEX "StoredFile_ownerTenantId_idx" ON "StoredFile"("ownerTenantId");

CREATE UNIQUE INDEX "StoredFile_id_ownerTenantId_key" ON "StoredFile"("id", "ownerTenantId");

ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_bannerFileId_id_fkey" FOREIGN KEY ("bannerFileId", "id") REFERENCES "StoredFile"("id", "ownerTenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_ownerTenantId_fkey" FOREIGN KEY ("ownerTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ограничения — те же, что в разделе 26 constraints.sql (размер и тип
-- переопределены там же, в разделе 18).
ALTER TABLE "StoredFile" DROP CONSTRAINT "StoredFile_size_within_limit";
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_size_within_limit"
  CHECK (
    "size" > 0 AND
    CASE "kind"
      WHEN 'AVATAR' THEN "size" <= 1048576
      WHEN 'RANK_DOCUMENT' THEN "size" <= 10485760
      WHEN 'COACH_PHOTO' THEN "size" <= 1048576
      WHEN 'CLUB_BANNER' THEN "size" <= 2097152
    END
  );

ALTER TABLE "StoredFile" DROP CONSTRAINT "StoredFile_type_matches_kind";
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_type_matches_kind"
  CHECK (
    CASE "kind"
      WHEN 'AVATAR' THEN "contentType" = 'image/webp'
      WHEN 'RANK_DOCUMENT' THEN "contentType" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      WHEN 'COACH_PHOTO' THEN "contentType" = 'image/webp'
      WHEN 'CLUB_BANNER' THEN "contentType" = 'image/webp'
    END
  );

ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_one_owner"
  CHECK (
    num_nonnulls("ownerUserId", "ownerTenantId") = 1
    AND ("ownerTenantId" IS NOT NULL) = ("kind" = 'CLUB_BANNER')
  );

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_description_sane"
  CHECK ("description" IS NULL OR ("description" = btrim("description") AND char_length("description") BETWEEN 1 AND 2000));

-- Тренерский состав на странице клуба: место в списке, только у тренера.
ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_coach_list_only_coach"
  CHECK ("coachListOrder" IS NULL OR ("role" = 'COACH' AND "coachListOrder" BETWEEN 1 AND 100));

CREATE UNIQUE INDEX "TenantMembership_coach_list_order_unique"
  ON "TenantMembership" ("tenantId", "coachListOrder")
  WHERE "coachListOrder" IS NOT NULL;

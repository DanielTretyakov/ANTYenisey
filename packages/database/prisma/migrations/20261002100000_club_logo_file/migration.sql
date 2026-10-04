-- Логотип клуба — загруженный квадрат, баннера больше нет (решение владельца
-- от 02.10.2026: у клуба только логотип и фирменный цвет, снимков нет).
--
-- Единственный файл клуба был баннером, и его конвейер — владелец-клуб,
-- составной ключ (файл, клуб), открытая раздача — переходит к логотипу.
-- Баннеры удаляются: оформлять ими страницу клуба больше нельзя, а держать
-- файлы, которые нигде не показываются, незачем.
UPDATE "Tenant" SET "bannerFileId" = NULL WHERE "bannerFileId" IS NOT NULL;

DELETE FROM "StoredFile" WHERE "kind" = 'CLUB_BANNER';

-- Значение переименовывается, а не заводится новое: строк с ним уже нет, а
-- новое значение enum в Postgres нельзя использовать в той же транзакции,
-- где оно добавлено, — CHECK ниже на нём и строится.
ALTER TYPE "StoredFileKind" RENAME VALUE 'CLUB_BANNER' TO 'CLUB_LOGO';

ALTER TABLE "Tenant" RENAME COLUMN "bannerFileId" TO "logoFileId";
ALTER TABLE "Tenant" RENAME CONSTRAINT "Tenant_bannerFileId_id_fkey" TO "Tenant_logoFileId_id_fkey";

-- Ссылка на произвольную картинку уходит: квадрат по ссылке сервер не
-- проверит, а загрузить знак теперь можно в настройках клуба.
ALTER TABLE "Tenant" DROP COLUMN "logoUrl";

-- Ограничения с видом файла клуба — заново, под логотип. Потолок — как у
-- аватара: тот же квадрат 512×512 WebP (у баннера 1600×500 было 2 МБ).
ALTER TABLE "StoredFile" DROP CONSTRAINT "StoredFile_size_within_limit";
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_size_within_limit"
  CHECK (
    "size" > 0 AND
    CASE "kind"
      WHEN 'AVATAR' THEN "size" <= 1048576
      WHEN 'RANK_DOCUMENT' THEN "size" <= 10485760
      WHEN 'COACH_PHOTO' THEN "size" <= 1048576
      WHEN 'CLUB_LOGO' THEN "size" <= 1048576
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
      WHEN 'CLUB_LOGO' THEN "contentType" = 'image/webp'
    END
  );

ALTER TABLE "StoredFile" DROP CONSTRAINT "StoredFile_one_owner";
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_one_owner"
  CHECK (
    num_nonnulls("ownerUserId", "ownerTenantId") = 1
    AND ("ownerTenantId" IS NOT NULL) = ("kind" = 'CLUB_LOGO')
  );

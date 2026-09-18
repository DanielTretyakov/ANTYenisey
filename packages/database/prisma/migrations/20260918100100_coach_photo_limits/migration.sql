-- Ограничения на файл фотографии тренера: те же, что у аватара игрока.
--
-- Отдельной миграцией, а не вместе с добавлением значения перечисления:
-- Postgres не даёт сослаться на новое значение enum в той же транзакции, где
-- оно добавлено («unsafe use of new value»).

ALTER TABLE "StoredFile" DROP CONSTRAINT "StoredFile_size_within_limit";

ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_size_within_limit"
  CHECK (
    "size" > 0 AND
    CASE "kind"
      WHEN 'AVATAR' THEN "size" <= 1048576
      WHEN 'RANK_DOCUMENT' THEN "size" <= 10485760
      WHEN 'COACH_PHOTO' THEN "size" <= 1048576
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
    END
  );

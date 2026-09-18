-- Карточка тренера: фото файлом вместо адреса.
--
-- Поле photoUrl не использовалось нигде в приложении: ни загрузки, ни чтения.
-- Фото переезжает на StoredFile по образцу аватара игрока (решение владельца
-- продукта от 18.09.2026) — внешней ссылке нечем подтвердить, что за ней
-- картинка, и веб читает файлы байтами, а не адресом в <img src>.

-- AlterEnum
ALTER TYPE "StoredFileKind" ADD VALUE 'COACH_PHOTO';

-- AlterTable
ALTER TABLE "CoachProfile" DROP COLUMN "photoUrl",
ADD COLUMN     "photoFileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_photoFileId_key" ON "CoachProfile"("photoFileId");

-- AddForeignKey
--
-- Ключ составной — (файл, этот же человек): чужой файл в карточку не положить.
-- NO ACTION, а не RESTRICT: удаление учётки уносит каскадом и карточку, и файл
-- одним оператором, а RESTRICT остановил бы его, если бы файл удалялся первым.
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_photoFileId_userId_fkey" FOREIGN KEY ("photoFileId", "userId") REFERENCES "StoredFile"("id", "ownerUserId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Пусто — это NULL, а не пустая строка: у «не заполнено» одно написание, иначе
-- публичная страница рисует пустоту под заголовком.
ALTER TABLE "CoachProfile"
  ADD CONSTRAINT "CoachProfile_text_filled"
  CHECK (
    ("achievements" IS NULL OR ("achievements" = btrim("achievements") AND char_length("achievements") BETWEEN 1 AND 2000))
    AND ("inventory" IS NULL OR ("inventory" = btrim("inventory") AND char_length("inventory") BETWEEN 1 AND 1000))
    AND ("priceInfo" IS NULL OR ("priceInfo" = btrim("priceInfo") AND char_length("priceInfo") BETWEEN 1 AND 500))
  );

-- Фотография тренера не должна мешать удалению учётки.
--
-- У профиля игрока связь с файлом NO ACTION, и каскад проходит: профиль —
-- прямой потомок учётки, и он исчезает в той же волне, что и файл. Карточка
-- тренера висит на членстве в клубе, то есть на уровень глубже, и Postgres
-- успевает проверить ссылку на файл раньше, чем каскад доходит до карточки, —
-- удаление учётки падало.
--
-- Отложенная проверка сдвигает её на конец транзакции, когда карточки уже нет.
-- Живому фото из-под живой карточки это по-прежнему уйти не даёт.

ALTER TABLE "CoachProfile" DROP CONSTRAINT "CoachProfile_photoFileId_userId_fkey";

ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_photoFileId_userId_fkey"
  FOREIGN KEY ("photoFileId", "userId") REFERENCES "StoredFile"("id", "ownerUserId")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

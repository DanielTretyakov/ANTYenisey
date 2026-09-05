-- Единый аккаунт на платформу (ТЗ → «Платформа и клубы: единый аккаунт»).
--
-- Что происходит: User перестаёт принадлежать клубу. Роль и всё клубное
-- переезжают на TenantMembership — пару «человек + клуб», которая становится
-- новой мишенью составных внешних ключей. Изоляция клубов при этом не
-- ослабевает: цепочка «бронь → профиль → привязка → (человек, клуб)» так же
-- не даёт свести стол одного клуба с клиентом другого, просто стала на звено
-- длиннее.
--
-- Данные СОХРАНЯЮТСЯ. Учётки с одинаковой почтой в разных клубах сливаются в
-- одну: побеждает самая свежая по updatedAt (человек правил именно её —
-- значит, там актуальный телефон и тот пароль, который он помнит). Проигравшие
-- строки не удаляют историю: их брони, платежи и визиты переезжают на
-- выжившую учётку вместе с привязкой к своему клубу.
--
-- Миграция написана руками, а не сгенерирована целиком: prisma migrate видит
-- только разницу схем и на месте переноса данных оставил бы DROP COLUMN.

-- ---------------------------------------------------------------------------
-- A. Снимаем внешние ключи, которые сейчас целятся в User(id, tenantId)
--    и в профили. Пока они стоят, ни слить учётки, ни поменять первичный
--    ключ профиля нельзя.
-- ---------------------------------------------------------------------------

ALTER TABLE "ClientProfile" DROP CONSTRAINT "ClientProfile_userId_tenantId_fkey";
ALTER TABLE "CoachProfile" DROP CONSTRAINT "CoachProfile_userId_tenantId_fkey";
ALTER TABLE "VisitLog" DROP CONSTRAINT "VisitLog_recordedByUserId_tenantId_fkey";
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorUserId_tenantId_fkey";
ALTER TABLE "LegalAcceptance" DROP CONSTRAINT "LegalAcceptance_userId_tenantId_fkey";
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_tenantId_fkey";
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_tenantId_fkey";
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_tenantId_fkey";
ALTER TABLE "User" DROP CONSTRAINT "User_tenantId_fkey";

-- Дети профилей: их ключи целятся в ClientProfile/CoachProfile(userId,
-- tenantId), а этот индекс ниже уступает место первичному ключу.
ALTER TABLE "TrainingBooking" DROP CONSTRAINT "TrainingBooking_clientId_tenantId_fkey";
ALTER TABLE "TournamentRegistration" DROP CONSTRAINT "TournamentRegistration_clientId_tenantId_fkey";
ALTER TABLE "TableBooking" DROP CONSTRAINT "TableBooking_clientId_tenantId_fkey";
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_clientId_tenantId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_clientId_tenantId_fkey";
ALTER TABLE "VisitLog" DROP CONSTRAINT "VisitLog_clientId_tenantId_fkey";
ALTER TABLE "TableClosureRule" DROP CONSTRAINT "TableClosureRule_clientId_tenantId_fkey";
ALTER TABLE "DayClosure" DROP CONSTRAINT "DayClosure_clientId_tenantId_fkey";
ALTER TABLE "TrainingSession" DROP CONSTRAINT "TrainingSession_coachId_tenantId_fkey";
ALTER TABLE "TableBooking" DROP CONSTRAINT "TableBooking_coachId_tenantId_fkey";
ALTER TABLE "VisitLog" DROP CONSTRAINT "VisitLog_coachId_tenantId_fkey";
ALTER TABLE "TableClosureRule" DROP CONSTRAINT "TableClosureRule_coachId_tenantId_fkey";
ALTER TABLE "DayClosure" DROP CONSTRAINT "DayClosure_coachId_tenantId_fkey";

-- ---------------------------------------------------------------------------
-- B. Первичный ключ профилей становится составным.
--
-- Пока User принадлежал клубу, userId в одиночку годился в ключ. Теперь один
-- аккаунт законно является клиентом в трёх клубах — это три анкеты, и в ключ
-- из одного userId они не влезают.
--
-- Идёт ДО слияния, а не после: слияние как раз и сводит две анкеты одного
-- человека под один userId, и на старом ключе оно упирается в него же.
-- ---------------------------------------------------------------------------

ALTER TABLE "ClientProfile" DROP CONSTRAINT "ClientProfile_pkey",
    ADD CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("userId", "tenantId");
DROP INDEX "ClientProfile_userId_tenantId_key";

ALTER TABLE "CoachProfile" DROP CONSTRAINT "CoachProfile_pkey",
    ADD CONSTRAINT "CoachProfile_pkey" PRIMARY KEY ("userId", "tenantId");
DROP INDEX "CoachProfile_userId_tenantId_key";

-- ---------------------------------------------------------------------------
-- C. Привязка «человек + клуб». Одна строка на каждую нынешнюю учётку:
--    сегодня у человека ровно один клуб, и роль с отключением переезжают
--    один в один.
-- ---------------------------------------------------------------------------

CREATE TABLE "TenantMembership" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CLIENT',
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("userId","tenantId")
);

INSERT INTO "TenantMembership" ("userId", "tenantId", "role", "deactivatedAt", "createdAt", "updatedAt")
SELECT id, "tenantId", role, "deactivatedAt", "createdAt", "updatedAt"
FROM "User";

-- ---------------------------------------------------------------------------
-- D. Слияние дублей по почте.
--
-- До этой миграции почта была уникальна парой (клуб, почта), поэтому один
-- человек, игравший в двух клубах, — это две строки User. Теперь почта
-- уникальна по платформе, и такие строки обязаны стать одной.
--
-- Правило: побеждает самая свежая по updatedAt. Она же отдаёт ФИО, телефон,
-- дату рождения и пароль — то есть человек входит тем паролем, который менял
-- последним. При равенстве отметок берётся более поздняя по createdAt, при
-- равенстве и там — меньший id, чтобы результат не зависел от порядка строк.
--
-- Анонимизированные учётки в слияние не идут: их почта затёрта на
-- «deleted-<id>@invalid» и уникальна по построению, а склеивать два
-- обезличенных следа значило бы восстанавливать связь, которую 152-ФЗ велел
-- разорвать.
-- ---------------------------------------------------------------------------

CREATE TEMPORARY TABLE "_account_merge" AS
WITH ranked AS (
    SELECT
        id,
        first_value(id) OVER (
            PARTITION BY lower(email)
            ORDER BY "updatedAt" DESC, "createdAt" DESC, id ASC
        ) AS survivor
    FROM "User"
    WHERE "anonymizedAt" IS NULL
)
SELECT id AS loser, survivor
FROM ranked
WHERE id <> survivor;

-- Привязки к клубам: клуб проигравшей учётки переходит выжившей. Столкнуться
-- по первичному ключу они не могут — дубли по построению жили в РАЗНЫХ клубах
-- (внутри клуба почта и раньше была уникальна).
UPDATE "TenantMembership" m SET "userId" = x.survivor FROM "_account_merge" x WHERE m."userId" = x.loser;

-- Анкеты ролей и всё, что на них висит.
UPDATE "ClientProfile" t SET "userId" = x.survivor FROM "_account_merge" x WHERE t."userId" = x.loser;
UPDATE "CoachProfile" t SET "userId" = x.survivor FROM "_account_merge" x WHERE t."userId" = x.loser;
UPDATE "TrainingBooking" t SET "clientId" = x.survivor FROM "_account_merge" x WHERE t."clientId" = x.loser;
UPDATE "TournamentRegistration" t SET "clientId" = x.survivor FROM "_account_merge" x WHERE t."clientId" = x.loser;
UPDATE "TableBooking" t SET "clientId" = x.survivor FROM "_account_merge" x WHERE t."clientId" = x.loser;
UPDATE "TableBooking" t SET "coachId" = x.survivor FROM "_account_merge" x WHERE t."coachId" = x.loser;
UPDATE "Subscription" t SET "clientId" = x.survivor FROM "_account_merge" x WHERE t."clientId" = x.loser;
UPDATE "Payment" t SET "clientId" = x.survivor FROM "_account_merge" x WHERE t."clientId" = x.loser;
UPDATE "VisitLog" t SET "clientId" = x.survivor FROM "_account_merge" x WHERE t."clientId" = x.loser;
UPDATE "VisitLog" t SET "coachId" = x.survivor FROM "_account_merge" x WHERE t."coachId" = x.loser;
UPDATE "VisitLog" t SET "recordedByUserId" = x.survivor FROM "_account_merge" x WHERE t."recordedByUserId" = x.loser;
UPDATE "TrainingSession" t SET "coachId" = x.survivor FROM "_account_merge" x WHERE t."coachId" = x.loser;
UPDATE "TableClosureRule" t SET "clientId" = x.survivor FROM "_account_merge" x WHERE t."clientId" = x.loser;
UPDATE "TableClosureRule" t SET "coachId" = x.survivor FROM "_account_merge" x WHERE t."coachId" = x.loser;
UPDATE "DayClosure" t SET "clientId" = x.survivor FROM "_account_merge" x WHERE t."clientId" = x.loser;
UPDATE "DayClosure" t SET "coachId" = x.survivor FROM "_account_merge" x WHERE t."coachId" = x.loser;
UPDATE "AuditLog" t SET "actorUserId" = x.survivor FROM "_account_merge" x WHERE t."actorUserId" = x.loser;
UPDATE "LegalAcceptance" t SET "userId" = x.survivor FROM "_account_merge" x WHERE t."userId" = x.loser;
UPDATE "Notification" t SET "userId" = x.survivor FROM "_account_merge" x WHERE t."userId" = x.loser;
UPDATE "RefreshToken" t SET "userId" = x.survivor FROM "_account_merge" x WHERE t."userId" = x.loser;

DELETE FROM "User" u USING "_account_merge" x WHERE u.id = x.loser;

DROP TABLE "_account_merge";

-- Аккаунт остаётся действующим, если человек активен хотя бы в одном клубе.
-- Отключение в конкретном клубе теперь живёт на привязке — платформенный
-- запрет входа для уволенного тренера «Енисея» был бы слишком широким:
-- в соседнем клубе он играет как ни в чём не бывало.
UPDATE "User" u
SET "deactivatedAt" = NULL
WHERE u."deactivatedAt" IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM "TenantMembership" m
      WHERE m."userId" = u.id AND m."deactivatedAt" IS NULL
  );

-- Страховка: уникальный индекс ниже упал бы с текстом Postgres про
-- нарушение ограничения и без единой подсказки, кого чинить.
DO $$
DECLARE collisions TEXT;
BEGIN
    SELECT string_agg(email, ', ') INTO collisions
    FROM (SELECT email FROM "User" GROUP BY email HAVING count(*) > 1) d;

    IF collisions IS NOT NULL THEN
        RAISE EXCEPTION 'Слияние учётных записей не завершено: почта остаётся у нескольких аккаунтов (%). Такое возможно только у анонимизированных учёток — их почта должна быть вида deleted-<id>@invalid.', collisions;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- E. Гасим все refresh-сессии.
--
-- Формат access-токена меняется (клуб и роль из него уходят), а сама сессия
-- перестаёт принадлежать клубу. Оставить выданные токены значило бы пустить
-- в новую модель прав людей со старыми: пусть войдут заново.
-- ---------------------------------------------------------------------------

UPDATE "RefreshToken" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "revokedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- F. Убираем то, что переехало.
-- ---------------------------------------------------------------------------

DROP INDEX "User_id_tenantId_key";
DROP INDEX "User_tenantId_email_key";
DROP INDEX "User_tenantId_role_idx";
DROP INDEX "RefreshToken_tenantId_userId_idx";

ALTER TABLE "User" DROP COLUMN "role", DROP COLUMN "tenantId";
ALTER TABLE "RefreshToken" DROP COLUMN "tenantId";

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX "TenantMembership_tenantId_role_idx" ON "TenantMembership"("tenantId", "role");

-- ---------------------------------------------------------------------------
-- G. Возвращаем внешние ключи. Всё клубное целится теперь в привязку.
-- ---------------------------------------------------------------------------

ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_recordedByUserId_tenantId_fkey" FOREIGN KEY ("recordedByUserId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_tenantId_fkey" FOREIGN KEY ("actorUserId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrainingBooking" ADD CONSTRAINT "TrainingBooking_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableClosureRule" ADD CONSTRAINT "TableClosureRule_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_coachId_tenantId_fkey" FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_coachId_tenantId_fkey" FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_coachId_tenantId_fkey" FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableClosureRule" ADD CONSTRAINT "TableClosureRule_coachId_tenantId_fkey" FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_coachId_tenantId_fkey" FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Семья: закрепление ребёнка за родителем.
-- Расширение сверх ТЗ по решениям владельца от 12.09 и 17.09.2026.

-- CreateEnum
CREATE TYPE "GuardianshipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'REVOKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CHILD_ACCOUNT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'GUARDIANSHIP_REVOKED';

-- CreateTable
CREATE TABLE "Guardianship" (
    "id" TEXT NOT NULL,
    "childUserId" TEXT NOT NULL,
    "guardianUserId" TEXT NOT NULL,
    "status" "GuardianshipStatus" NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdInTenantId" TEXT,
    "confirmedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByUserId" TEXT,
    "revokedInTenantId" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Guardianship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Guardianship_childUserId_status_idx" ON "Guardianship"("childUserId", "status");

-- CreateIndex
CREATE INDEX "Guardianship_guardianUserId_status_idx" ON "Guardianship"("guardianUserId", "status");

-- CreateIndex
CREATE INDEX "Guardianship_createdByUserId_createdInTenantId_idx" ON "Guardianship"("createdByUserId", "createdInTenantId");

-- CreateIndex
CREATE INDEX "Guardianship_revokedByUserId_revokedInTenantId_idx" ON "Guardianship"("revokedByUserId", "revokedInTenantId");

-- AddForeignKey
ALTER TABLE "Guardianship" ADD CONSTRAINT "Guardianship_childUserId_fkey" FOREIGN KEY ("childUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardianship" ADD CONSTRAINT "Guardianship_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardianship" ADD CONSTRAINT "Guardianship_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardianship" ADD CONSTRAINT "Guardianship_createdByUserId_createdInTenantId_fkey" FOREIGN KEY ("createdByUserId", "createdInTenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardianship" ADD CONSTRAINT "Guardianship_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardianship" ADD CONSTRAINT "Guardianship_revokedByUserId_revokedInTenantId_fkey" FOREIGN KEY ("revokedByUserId", "revokedInTenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Ограничения целостности — раздел 19 constraints.sql
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
--
-- Накатано миграцией *_guardianship. Расширение сверх ТЗ по решениям
-- владельца от 12.09 и 17.09.2026. За строкой — право записывать чужого
-- человека, отменять его записи и видеть его историю и скан приказа.

-- Родитель один.
--
-- Уникальна только ДЕЙСТВУЮЩАЯ опека, а не любая строка по ребёнку: после
-- снятия ребёнка законно закрепляют заново, а заявок бывает несколько — иначе
-- посторонний, знающий почту ребёнка, первой заявкой занял бы место
-- настоящего родителя. Подтверждение одной заявки закрывает остальные, а гонку
-- двух подтверждений ловит этот индекс.
CREATE UNIQUE INDEX "Guardianship_one_active_per_child"
  ON "Guardianship" ("childUserId")
  WHERE "status" = 'ACTIVE'::"GuardianshipStatus";

-- Одна ждущая заявка от одного взрослого одному ребёнку: повторное нажатие —
-- то же намерение, а не вторая строка в кабинете ребёнка.
CREATE UNIQUE INDEX "Guardianship_one_pending_per_pair"
  ON "Guardianship" ("childUserId", "guardianUserId")
  WHERE "status" = 'PENDING'::"GuardianshipStatus";

ALTER TABLE "Guardianship"
  ADD CONSTRAINT "Guardianship_not_self"
  CHECK ("childUserId" <> "guardianUserId");

-- Состояние несёт свои отметки и не несёт чужих: подтверждённая — момент
-- подтверждения, отклонённая — момент отказа, снятая — момент и того, кто
-- снял. Заявка без ответа не несёт ничего.
ALTER TABLE "Guardianship"
  ADD CONSTRAINT "Guardianship_status_matches_times"
  CHECK (
    CASE "status"
      WHEN 'PENDING' THEN "confirmedAt" IS NULL AND "rejectedAt" IS NULL
                      AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL
      WHEN 'ACTIVE' THEN "confirmedAt" IS NOT NULL AND "rejectedAt" IS NULL
                     AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL
      WHEN 'REJECTED' THEN "rejectedAt" IS NOT NULL AND "confirmedAt" IS NULL
                       AND "revokedAt" IS NULL AND "revokedByUserId" IS NULL
      WHEN 'REVOKED' THEN "confirmedAt" IS NOT NULL AND "revokedAt" IS NOT NULL
                      AND "revokedByUserId" IS NOT NULL
    END
  );

-- Клуб, снявший закрепление, называет того, кто снял, и объясняет почему:
-- восстановления пароля нет, и отзыв клубом — выход для ребёнка, чей родитель
-- потерял учётку, а не способ переписать семью без следа.
--
-- Клуб без человека пропускать нельзя: составной внешний ключ с одной пустой
-- половиной Postgres не проверяет вовсе (MATCH SIMPLE).
ALTER TABLE "Guardianship"
  ADD CONSTRAINT "Guardianship_club_revoke_explained"
  CHECK (
    "revokedInTenantId" IS NULL
    OR ("revokedByUserId" IS NOT NULL AND "revokeReason" IS NOT NULL)
  );

ALTER TABLE "Guardianship"
  ADD CONSTRAINT "Guardianship_revoke_reason_filled"
  CHECK ("revokeReason" IS NULL OR ("revokeReason" = btrim("revokeReason") AND char_length("revokeReason") BETWEEN 1 AND 500));

-- Чего здесь НЕТ и почему.
--
-- Возраст — «ребёнку меньше 16», «родителю 18» — в CHECK не выражается: это
-- сравнение с сегодняшним днём, а now() не IMMUTABLE (та же причина, что в
-- разделах 17 и 18). Правила — guardianship-rules.ts, под тестами, и
-- проверяются в момент каждого действия: в день шестнадцатилетия строка
-- остаётся ACTIVE как история, а права кончаются сами.
--
-- Что снимающий от имени клуба там администратор, а ребёнок в этом клубе
-- состоит, — сравнение строк других таблиц. Это держит сервис, а база держит
-- главное: снимающий — человек именно того клуба, что записан.

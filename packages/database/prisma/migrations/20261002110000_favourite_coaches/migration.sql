-- «Мои тренеры» — избранные тренеры человека (решение владельца от 02.10.2026).
CREATE TABLE "UserCoach" (
    "userId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCoach_pkey" PRIMARY KEY ("userId","coachId")
);

CREATE INDEX "UserCoach_coachId_idx" ON "UserCoach"("coachId");

ALTER TABLE "UserCoach" ADD CONSTRAINT "UserCoach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserCoach" ADD CONSTRAINT "UserCoach_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Себя в избранные тренеры не отмечают (constraints.sql, раздел 35).
ALTER TABLE "UserCoach"
  ADD CONSTRAINT "UserCoach_not_self"
  CHECK ("userId" <> "coachId");

-- Залы видов мероприятий и тренеров (решение владельца от 25.09.2026):
-- одна организация, залы в разных городах. Нет строк — «во всех залах».
-- Ключи составные по клубу: вид или тренер не привяжется к чужому залу.

-- CreateTable
CREATE TABLE "TrainingTypeHall" (
    "trainingTypeId" TEXT NOT NULL,
    "hallId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "TrainingTypeHall_pkey" PRIMARY KEY ("trainingTypeId","hallId")
);

-- CreateTable
CREATE TABLE "TournamentTypeHall" (
    "tournamentTypeId" TEXT NOT NULL,
    "hallId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "TournamentTypeHall_pkey" PRIMARY KEY ("tournamentTypeId","hallId")
);

-- CreateTable
CREATE TABLE "CoachHall" (
    "coachId" TEXT NOT NULL,
    "hallId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "CoachHall_pkey" PRIMARY KEY ("coachId","hallId")
);

-- CreateIndex
CREATE INDEX "TrainingTypeHall_hallId_idx" ON "TrainingTypeHall"("hallId");

-- CreateIndex
CREATE INDEX "TrainingTypeHall_tenantId_idx" ON "TrainingTypeHall"("tenantId");

-- CreateIndex
CREATE INDEX "TournamentTypeHall_hallId_idx" ON "TournamentTypeHall"("hallId");

-- CreateIndex
CREATE INDEX "TournamentTypeHall_tenantId_idx" ON "TournamentTypeHall"("tenantId");

-- CreateIndex
CREATE INDEX "CoachHall_hallId_idx" ON "CoachHall"("hallId");

-- CreateIndex
CREATE INDEX "CoachHall_tenantId_idx" ON "CoachHall"("tenantId");

-- AddForeignKey
ALTER TABLE "TrainingTypeHall" ADD CONSTRAINT "TrainingTypeHall_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingTypeHall" ADD CONSTRAINT "TrainingTypeHall_trainingTypeId_tenantId_fkey" FOREIGN KEY ("trainingTypeId", "tenantId") REFERENCES "TrainingType"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingTypeHall" ADD CONSTRAINT "TrainingTypeHall_hallId_tenantId_fkey" FOREIGN KEY ("hallId", "tenantId") REFERENCES "Hall"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTypeHall" ADD CONSTRAINT "TournamentTypeHall_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTypeHall" ADD CONSTRAINT "TournamentTypeHall_tournamentTypeId_tenantId_fkey" FOREIGN KEY ("tournamentTypeId", "tenantId") REFERENCES "TournamentType"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTypeHall" ADD CONSTRAINT "TournamentTypeHall_hallId_tenantId_fkey" FOREIGN KEY ("hallId", "tenantId") REFERENCES "Hall"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachHall" ADD CONSTRAINT "CoachHall_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachHall" ADD CONSTRAINT "CoachHall_coachId_tenantId_fkey" FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachHall" ADD CONSTRAINT "CoachHall_hallId_tenantId_fkey" FOREIGN KEY ("hallId", "tenantId") REFERENCES "Hall"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Заведение клуба из заявки и черновик (решения владельца от 11.10.2026):
-- клуб без publishedAt — черновик, его видят только свои. Все уже
-- существующие клубы открыты с момента заведения.

-- AlterTable
ALTER TABLE "ClubApplication" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "publishedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "ClubApplication_tenantId_key" ON "ClubApplication"("tenantId");

-- AddForeignKey
ALTER TABLE "ClubApplication" ADD CONSTRAINT "ClubApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


UPDATE "Tenant" SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL;

-- Код клуба — участок адреса: строчная латиница и цифры через дефис. То же —
-- в constraints.sql.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_slug_format"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 3 AND 40);

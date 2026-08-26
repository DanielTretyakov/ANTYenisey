-- Закрытое время столов: недельное расписание и разовые окна.
--
-- Ограничения целостности (диапазоны минут, день недели, запрет пересечений)
-- идут ниже в этом же файле: они невыразимы в schema.prisma и хранятся в
-- prisma/constraints.sql, откуда скопированы сюда.

-- CreateTable
CREATE TABLE "TableClosureRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableClosureRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableClosure" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TableClosureRule_tenantId_weekday_idx" ON "TableClosureRule"("tenantId", "weekday");

-- CreateIndex
CREATE INDEX "TableClosureRule_tableId_idx" ON "TableClosureRule"("tableId");

-- CreateIndex
CREATE INDEX "TableClosure_tenantId_startsAt_idx" ON "TableClosure"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "TableClosure_tableId_idx" ON "TableClosure"("tableId");

-- AddForeignKey
ALTER TABLE "TableClosureRule" ADD CONSTRAINT "TableClosureRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableClosureRule" ADD CONSTRAINT "TableClosureRule_tableId_tenantId_fkey" FOREIGN KEY ("tableId", "tenantId") REFERENCES "Table"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableClosure" ADD CONSTRAINT "TableClosure_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableClosure" ADD CONSTRAINT "TableClosure_tableId_tenantId_fkey" FOREIGN KEY ("tableId", "tenantId") REFERENCES "Table"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 12. Закрытое время столов
-- ---------------------------------------------------------------------------
--
-- Накатано отдельной миграцией *_table_closures: этот файл правится вместе со
-- схемой, а применённую миграцию Prisma сверяет по контрольной сумме и
-- откажется работать с изменённой задним числом.

-- Границы окна недельного правила: полночь как конец — это 1440, а не 0,
-- иначе интервал вывернулся бы и правило «с 23:00 до полуночи» стало бы
-- пустым.
ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_minutes_range"
  CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");

-- День недели по ISO-8601: 1 — понедельник, 7 — воскресенье. Ноль здесь
-- запрещён намеренно: в разных языках он означает то воскресенье, то
-- понедельник, и одна такая строка тихо сдвинула бы расписание на день.
ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_weekday_range"
  CHECK ("weekday" BETWEEN 1 AND 7);

-- Одно и то же время одного стола не должно быть закрыто двумя правилами:
-- иначе снятие блокировки в сетке убирало бы одну строку, а вторая оставляла
-- бы стол закрытым, и администратор не понимал бы, почему.
-- Диапазон полуоткрытый '[)': окна 15:00-17:00 и 17:00-19:00 стыкуются.
ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_no_overlap"
  EXCLUDE USING gist (
    "tableId" WITH =,
    "weekday" WITH =,
    int4range("startMinute", "endMinute", '[)') WITH &&
  );

ALTER TABLE "TableClosure"
  ADD CONSTRAINT "TableClosure_time_order" CHECK ("endsAt" > "startsAt");

-- То же для разовых окон.
ALTER TABLE "TableClosure"
  ADD CONSTRAINT "TableClosure_no_overlap"
  EXCLUDE USING gist (
    "tableId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  );

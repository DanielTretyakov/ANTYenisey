-- Абонементы клиента: снимок цены и продавец, бессрочные тарифы, оплата записи
-- абонементом её же клиента. Решения владельца продукта от 19.09.2026.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "issuedByUserId" TEXT,
ADD COLUMN     "priceAtPurchase" INTEGER NOT NULL,
ALTER COLUMN "purchasedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "SubscriptionLedger" ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ALTER COLUMN "durationDays" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TournamentRegistration" ADD COLUMN     "subscriptionId" TEXT;

-- AlterTable
ALTER TABLE "TrainingBooking" ADD COLUMN     "subscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_id_clientId_tenantId_key" ON "Subscription"("id", "clientId", "tenantId");

-- CreateIndex
CREATE INDEX "SubscriptionLedger_trainingBookingId_idx" ON "SubscriptionLedger"("trainingBookingId");

-- CreateIndex
CREATE INDEX "SubscriptionLedger_tournamentRegistrationId_idx" ON "SubscriptionLedger"("tournamentRegistrationId");

-- AddForeignKey
ALTER TABLE "TrainingBooking" ADD CONSTRAINT "TrainingBooking_subscriptionId_clientId_tenantId_fkey" FOREIGN KEY ("subscriptionId", "clientId", "tenantId") REFERENCES "Subscription"("id", "clientId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_subscriptionId_clientId_tenantId_fkey" FOREIGN KEY ("subscriptionId", "clientId", "tenantId") REFERENCES "Subscription"("id", "clientId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_issuedByUserId_tenantId_fkey" FOREIGN KEY ("issuedByUserId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLedger" ADD CONSTRAINT "SubscriptionLedger_createdByUserId_tenantId_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 21. Абонементы клиента
-- ---------------------------------------------------------------------------
--
-- Накатано миграцией *_client_subscriptions. Решения владельца от 19.09.2026:
-- продаёт администратор у стойки (в перспективе — онлайн), визит списывается
-- при записи, срок — в днях до конца местного дня либо бессрочно.
--
-- Главное правило модели: истинное состояние визита — сама запись, а не
-- журнал. Визит списан при записи и возвращается отменой или прощённой
-- неявкой; «сгорел» — это просто «не вернулся», отдельной строки у сгорания
-- нет. Поэтому причины VISIT_BURNED и EXPIRED здесь запрещены: строка
-- «сгорел», записанная при неявке, осталась бы ложью навсегда, стоило клубу
-- исправить отметку на «пришёл».

-- Тариф: визиты и срок — положительные или «без предела» (NULL), но не
-- безлимит без срока: вечный безлимит клуб не продаёт, а опечатка в форме —
-- продаёт.
ALTER TABLE "SubscriptionPlan"
  ADD CONSTRAINT "SubscriptionPlan_terms_sane"
  CHECK (
    ("visitsCount" IS NULL OR "visitsCount" > 0)
    AND ("durationDays" IS NULL OR "durationDays" > 0)
    AND NOT ("visitsCount" IS NULL AND "durationDays" IS NULL)
    AND "price" >= 0
  );

ALTER TABLE "SubscriptionPlan"
  ADD CONSTRAINT "SubscriptionPlan_name_filled"
  CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 100);

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_price_non_negative"
  CHECK ("priceAtPurchase" >= 0);

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_expiry_after_purchase"
  CHECK ("expiresAt" IS NULL OR "expiresAt" > "purchasedAt");

-- Откуда абонемент: продал сотрудник у стойки или оплачен онлайн. Абонемент
-- ниоткуда — это визиты, за которые никто не заплатил и никто не ответит.
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_has_origin"
  CHECK ("issuedByUserId" IS NOT NULL OR "paymentId" IS NOT NULL);

-- Знак движения — по причине. Списание при записи — минус один визит (у
-- безлимита ноль, строка остаётся для истории), возврат — плюс один;
-- корректировка без изменения — не корректировка, кроме досрочного закрытия
-- безлимита, где визитов нет вовсе.
ALTER TABLE "SubscriptionLedger"
  ADD CONSTRAINT "SubscriptionLedger_delta_matches_reason"
  CHECK (
    CASE "reason"
      WHEN 'PURCHASE' THEN "delta" >= 0
      WHEN 'VISIT_CHARGED' THEN "delta" IN (-1, 0)
      WHEN 'VISIT_REFUNDED' THEN "delta" IN (0, 1)
      WHEN 'ADMIN_ADJUSTMENT' THEN "delta" <> 0 OR "balanceAfter" IS NULL
      ELSE false
    END
  );

ALTER TABLE "SubscriptionLedger"
  ADD CONSTRAINT "SubscriptionLedger_balance_non_negative"
  CHECK ("balanceAfter" IS NULL OR "balanceAfter" >= 0);

-- Движение по визиту ссылается ровно на одну запись — занятие или турнир;
-- покупка и корректировка — ни на одну. Аренда стола абонементом в этой фазе
-- не оплачивается, и ссылка на неё запрещена, пока правило не появится.
ALTER TABLE "SubscriptionLedger"
  ADD CONSTRAINT "SubscriptionLedger_link_matches_reason"
  CHECK (
    "tableBookingId" IS NULL
    AND CASE
      WHEN "reason" IN ('VISIT_CHARGED', 'VISIT_REFUNDED')
        THEN ("trainingBookingId" IS NOT NULL) <> ("tournamentRegistrationId" IS NOT NULL)
      ELSE "trainingBookingId" IS NULL AND "tournamentRegistrationId" IS NULL
    END
  );

-- Ручная корректировка — с автором и причиной: за ней чужие визиты, а то и
-- деньги, вернутые клиенту мимо системы.
ALTER TABLE "SubscriptionLedger"
  ADD CONSTRAINT "SubscriptionLedger_adjustment_explained"
  CHECK (
    ("note" IS NULL OR ("note" = btrim("note") AND char_length("note") BETWEEN 1 AND 500))
    AND ("reason" <> 'ADMIN_ADJUSTMENT' OR ("createdByUserId" IS NOT NULL AND "note" IS NOT NULL))
  );

-- У записи по абонементу процент — не доля цены, а судьба визита: 0 —
-- возвращён, 100 — израсходован. Половины визита не бывает.
ALTER TABLE "TrainingBooking"
  ADD CONSTRAINT "TrainingBooking_subscription_ratio"
  CHECK ("subscriptionId" IS NULL OR "chargeRatio" IS NULL OR "chargeRatio" IN (0, 100));

ALTER TABLE "TournamentRegistration"
  ADD CONSTRAINT "TournamentRegistration_subscription_ratio"
  CHECK ("subscriptionId" IS NULL OR "chargeRatio" IS NULL OR "chargeRatio" IN (0, 100));

-- Журнал абонементов — только вставки.
--
-- Как у журнала аудита, с одной оговоркой: DELETE пропускается, когда уборка
-- смоука явно попросила об этом (SET LOCAL yenisey.purge_probes = 'on').
-- Журнал ссылается на записи с Restrict, и без этого пробные записи было бы
-- не убрать никогда. Защита поэтому слабее, чем у AuditLog: кто может
-- выставить настройку сессии, тот может и удалить. Прикладной код этого не
-- делает — пишет журнал ровно одна функция и только вставками.
CREATE FUNCTION "SubscriptionLedger_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('yenisey.purge_probes', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'SubscriptionLedger — журнал только для вставок, % запрещён', TG_OP
    USING ERRCODE = '23001';
END
$$;

CREATE TRIGGER "SubscriptionLedger_append_only"
  BEFORE UPDATE OR DELETE ON "SubscriptionLedger"
  FOR EACH ROW EXECUTE FUNCTION "SubscriptionLedger_reject_change"();

CREATE TRIGGER "SubscriptionLedger_no_truncate"
  BEFORE TRUNCATE ON "SubscriptionLedger"
  FOR EACH STATEMENT EXECUTE FUNCTION "SubscriptionLedger_reject_change"();

-- Чего здесь НЕТ и почему.
--
-- Что кэш remainingVisits равен сумме журнала, а абонемент в строке журнала —
-- тот же, что на записи, — сравнение с другими строками. Держит единственный
-- писатель журнала (SubscriptionLedgerWriter): журнал и кэш меняются в одной
-- транзакции под FOR UPDATE по абонементу.
--
-- Что абонемент на записи действовал на момент мероприятия и покрывал его тип
-- — тоже сравнение с другими таблицами, и правило сервиса: подходящий
-- абонемент выбирает pickSubscription в момент записи.

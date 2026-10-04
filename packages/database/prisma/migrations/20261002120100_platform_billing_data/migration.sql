-- Данные и ограничения подписки клуба на КНТ (см. *_platform_billing).

-- Тарифы из ТЗ: месяц — 5 000 ₽, год — 50 000 ₽, три года — 130 000 ₽.
INSERT INTO "PlatformPlan" (id, name, "periodMonths", price, "isActive", "updatedAt")
VALUES ('platform-plan-month', 'Месяц', 1, 500000, true, now()),
       ('platform-plan-year', 'Год', 12, 5000000, true, now()),
       ('platform-plan-3years', '3 года', 36, 13000000, true, now())
ON CONFLICT (id) DO NOTHING;

-- Прежнее правило тарифа не знает TRIAL — снимаем до вставки, ниже оно
-- заводится заново.
ALTER TABLE "TenantSubscription" DROP CONSTRAINT "TenantSubscription_plan_required_unless_exempt";

-- Подписка есть у каждого клуба: «Енисей» — пилотный, без оплаты (ТЗ);
-- остальные — пробные 7 дней с момента выкладки. Отключает клубы только
-- `BillingJob`, а он включается отдельно (BILLING_JOB=on).
INSERT INTO "TenantSubscription" (id, "tenantId", status, "trialEndsAt", "updatedAt")
SELECT 'tsub-' || t.id, t.id,
       CASE WHEN t.slug = 'yenisey' THEN 'EXEMPT'::"PlatformSubscriptionStatus" ELSE 'TRIAL'::"PlatformSubscriptionStatus" END,
       CASE WHEN t.slug = 'yenisey' THEN NULL ELSE now() + interval '7 days' END,
       now()
  FROM "Tenant" t
 WHERE NOT EXISTS (SELECT 1 FROM "TenantSubscription" s WHERE s."tenantId" = t.id);

-- Тариф обязателен у платящей подписки. Без тарифа — EXEMPT («Енисей») и
-- TRIAL, пока клуб ничего не купил.
ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "TenantSubscription_plan_required_unless_exempt"
  CHECK (
    status IN ('EXEMPT'::"PlatformSubscriptionStatus", 'TRIAL'::"PlatformSubscriptionStatus")
    OR ("planId" IS NOT NULL AND "priceAtPurchase" IS NOT NULL)
  );

-- У пробного периода есть конец: иначе джоба не знает, когда его закрыть.
ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "TenantSubscription_trial_has_end"
  CHECK (status <> 'TRIAL'::"PlatformSubscriptionStatus" OR "trialEndsAt" IS NOT NULL);

-- Просрочка начинается с момента: от него считаются льготные три дня.
ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "TenantSubscription_past_due_has_start"
  CHECK (status <> 'PAST_DUE'::"PlatformSubscriptionStatus" OR "pastDueSince" IS NOT NULL);

ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "TenantSubscription_attempts_sane"
  CHECK ("chargeAttempts" >= 0);

-- Платёж платформе — положительная сумма в копейках.
ALTER TABLE "PlatformPayment"
  ADD CONSTRAINT "PlatformPayment_amount_positive"
  CHECK ("amount" > 0);

-- Счёт — с номером, карта — без; платёж ЮKassa бывает только у карты.
ALTER TABLE "PlatformPayment"
  ADD CONSTRAINT "PlatformPayment_method_shape"
  CHECK (
    ("method" = 'INVOICE'::"PlatformPaymentMethod") = ("invoiceNumber" IS NOT NULL)
    AND ("method" = 'CARD'::"PlatformPaymentMethod" OR "providerPaymentId" IS NULL)
    AND ("method" = 'CARD'::"PlatformPaymentMethod" OR NOT "autoCharge")
  );

-- Оплаченный — с моментом оплаты и сроком доступа; неоплаченный — без них.
ALTER TABLE "PlatformPayment"
  ADD CONSTRAINT "PlatformPayment_paid_shape"
  CHECK (
    ("status" = 'SUCCEEDED'::"PlatformPaymentStatus")
      = ("paidAt" IS NOT NULL AND "periodFrom" IS NOT NULL AND "periodTo" IS NOT NULL)
    AND ("periodTo" IS NULL OR "periodFrom" IS NULL OR "periodTo" > "periodFrom")
  );

ALTER TABLE "PlatformAct"
  ADD CONSTRAINT "PlatformAct_sane"
  CHECK ("amount" >= 0 AND "periodTo" > "periodFrom" AND "number" > 0);

-- Реквизиты для счёта: ИНН — 10 цифр у организации, 12 у ИП; КПП — 9.
ALTER TABLE "ClubRequisites"
  ADD CONSTRAINT "ClubRequisites_sane"
  CHECK (
    "inn" ~ '^([0-9]{10}|[0-9]{12})$'
    AND ("kpp" IS NULL OR "kpp" ~ '^[0-9]{9}$')
    AND "legalName" = btrim("legalName") AND char_length("legalName") BETWEEN 2 AND 300
    AND "address" = btrim("address") AND char_length("address") BETWEEN 5 AND 500
    AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  );

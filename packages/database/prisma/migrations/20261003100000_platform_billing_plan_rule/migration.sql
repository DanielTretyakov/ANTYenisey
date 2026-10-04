-- Тариф обязателен только у активной подписки. Клуб после пробного периода
-- законно не платил ни разу: в просрочку и в приостановку он уходит без
-- тарифа, и прежнее правило («тариф у всех, кроме EXEMPT и TRIAL») не давало
-- джобе его туда перевести.
ALTER TABLE "TenantSubscription" DROP CONSTRAINT "TenantSubscription_plan_required_unless_exempt";

ALTER TABLE "TenantSubscription"
  ADD CONSTRAINT "TenantSubscription_plan_required_unless_exempt"
  CHECK (
    status <> 'ACTIVE'::"PlatformSubscriptionStatus"
    OR ("planId" IS NOT NULL AND "priceAtPurchase" IS NOT NULL)
  );

-- Приоритетный зал сотрудника: первым на смене и в расписании (решение
-- владельца от 24.09.2026). Личный выбор на паре «человек + клуб».
--
-- Составной ключ на Hall(id, tenantId): зал другого клуба сюда не встанет.
-- RESTRICT, а не SET NULL: SET NULL обнулил бы и tenantId — половину
-- первичного ключа привязки. Выбор перед удалением зала снимает сервис.

ALTER TABLE "TenantMembership" ADD COLUMN "preferredHallId" TEXT;

ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_preferredHallId_tenantId_fkey" FOREIGN KEY ("preferredHallId", "tenantId") REFERENCES "Hall"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

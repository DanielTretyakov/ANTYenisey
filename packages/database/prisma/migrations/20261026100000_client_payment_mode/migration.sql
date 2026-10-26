-- Как клиенты платят клубу (решение владельца от 26.10.2026): на месте,
-- онлайн или на выбор при записи. У всех клубов — «на месте»: так они и
-- работают, онлайн-оплаты для клиентов пока нет.
CREATE TYPE "ClientPaymentMode" AS ENUM ('ON_SITE', 'ONLINE', 'HYBRID');

ALTER TABLE "Tenant" ADD COLUMN "paymentMode" "ClientPaymentMode" NOT NULL DEFAULT 'ON_SITE';

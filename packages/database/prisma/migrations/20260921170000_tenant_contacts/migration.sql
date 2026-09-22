-- Телефон и почта клуба.
--
-- До этой миграции у организации не было ни того ни другого: телефон хранился
-- только у людей. Страница клуба поэтому не могла ответить на первый вопрос
-- посетителя — «как с вами связаться», — и человек, нашедший зал в поиске,
-- упирался в тупик.
--
-- Оба поля необязательны: клуб может работать без общего номера, и пустое
-- место честнее выдуманного.

ALTER TABLE "Tenant" ADD COLUMN "phone" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "email" TEXT;

-- Формат тот же, что у телефона человека: номер уходит в ссылку `tel:`, и
-- «8 (391) …» из неё дозванивается не везде.
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_phone_format"
  CHECK ("phone" IS NULL OR "phone" ~ '^\+7[0-9]{10}$');

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_email_format"
  CHECK ("email" IS NULL OR "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

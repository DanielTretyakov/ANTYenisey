-- Утренние сводки (фаза 4): руководству клуба — вчерашние цифры, новые
-- люди, абонементы клиентов и план на сегодня; владельцу платформы — сводка
-- по всей платформе.

ALTER TYPE "NotificationType" ADD VALUE 'CLUB_DIGEST';
ALTER TYPE "NotificationType" ADD VALUE 'PLATFORM_DIGEST';

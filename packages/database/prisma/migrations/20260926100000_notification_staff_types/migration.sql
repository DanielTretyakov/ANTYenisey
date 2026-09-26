-- Сообщения персоналу (решения владельца от 26.09.2026): назначение на смену и
-- изменение настроек клуба. Отдельной миграцией: новое значение перечисления
-- нельзя использовать в той же транзакции, где оно добавлено.
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_SHIFT_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'CLUB_SETTINGS_CHANGED';

-- Уведомления клиенту (фаза 2): неявка, абонемент, разряд, заявка родителя.
-- Подтверждение, отмена и напоминание о записи были в перечне с первой
-- миграции.

ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_NO_SHOW';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_ENDING';
ALTER TYPE "NotificationType" ADD VALUE 'RANK_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE 'GUARDIANSHIP_REQUESTED';

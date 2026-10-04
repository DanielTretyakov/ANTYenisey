import { SetMetadata } from '@nestjs/common';

export const OPEN_WHEN_SUSPENDED = 'billing:openWhenSuspended';

/**
 * Маршрут клуба, который работает и при приостановленной подписке на КНТ.
 *
 * Приостановленный клуб отвечает только на чтение (ClubContextGuard): записи
 * и правки закрыты, иначе неоплата ничего бы не меняла. Открыта оплата —
 * без неё клуб не вернул бы себе доступ.
 */
export const OpenWhenSuspended = () => SetMetadata(OPEN_WHEN_SUSPENDED, true);

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Открывает маршрут без авторизации. Нужен потому, что JwtAuthGuard подключён
 * глобально и по умолчанию закрывает всё.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

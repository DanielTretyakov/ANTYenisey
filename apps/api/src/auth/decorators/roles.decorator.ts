import { SetMetadata } from '@nestjs/common';
import type { Role } from '@yenisey/types';

export const ROLES_KEY = 'roles';

/** Ограничивает маршрут перечисленными ролями. Проверяет RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

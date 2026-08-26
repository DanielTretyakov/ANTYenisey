import * as argon2 from 'argon2';

/**
 * Параметры argon2id. OWASP-минимум: 19 МиБ памяти, 2 прохода. Память здесь
 * важнее числа итераций — именно она делает перебор на GPU невыгодным.
 *
 * Вынесено из AuthService, потому что хеш пароля нужен не только сервису:
 * тем же алгоритмом и с теми же параметрами заводит учётку скрипт
 * scripts/create-admin.ts. Разъехавшиеся параметры дали бы пароль, который
 * молча не подходит.
 */
export const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

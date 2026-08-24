/**
 * Удаление тестовых пользователей, которых заводит apps/api/scripts/smoke-auth.mjs.
 *
 * Отдельный скрипт, а не уборка внутри самой проверки: та работает только по
 * HTTP и доступа к базе не имеет, а удаления пользователя через API нет и не
 * будет — в продукте «удаление» клиента это deactivatedAt, а не DELETE.
 *
 * Запуск: pnpm db:clean-probes
 */
// Путь оканчивается на /index.js, а не на каталог: скрипт запускается
// напрямую через node с нативным срезанием типов, то есть как ES-модуль, а
// тот не умеет достраивать /index к пути каталога.
import { PrismaClient } from '../generated/client/index.js';

const prisma = new PrismaClient();

// Ровно тот префикс, который ставит smoke-auth.mjs. Шире брать нельзя:
// скрипт не должен уметь снести живую клиентскую базу.
const PROBE_EMAIL_PREFIX = 'probe-';

async function main(): Promise<void> {
  const where = { email: { startsWith: PROBE_EMAIL_PREFIX } };

  const users = await prisma.user.findMany({ where, select: { id: true } });
  const ids = users.map((user) => user.id);

  if (ids.length === 0) {
    console.log('Тестовых пользователей не найдено.');
    return;
  }

  // Порядок важен: на связях стоит onDelete: Restrict, база не даст удалить
  // пользователя, пока на него ссылаются сессии и профиль.
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.clientProfile.deleteMany({ where: { userId: { in: ids } } });
  const removed = await prisma.user.deleteMany({ where });

  console.log(`Удалено тестовых пользователей: ${removed.count}`);
}

main()
  .catch((error: unknown) => {
    console.error('Уборка не выполнена:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

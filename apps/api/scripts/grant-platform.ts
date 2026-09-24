/**
 * Выдаёт (или снимает) роль владельца платформы.
 *
 * Роль даёт сводку платформы в MAX. Формы для неё нет и не будет: выдавать её
 * некому, кроме того, у кого есть доступ к базе, — отсюда команда, по образцу
 * create-admin.
 *
 * Запуск:
 *   pnpm db:grant-platform -- --email owner@example.ru
 *   pnpm db:grant-platform -- --email owner@example.ru --revoke
 *
 * Учётка должна уже существовать: команда не заводит людей, а только отмечает.
 */
import { PlatformRole, PrismaClient } from '@yenisey/database';

const prisma = new PrismaClient();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const emailIndex = argv.indexOf('--email');
  const email = emailIndex >= 0 ? argv[emailIndex + 1]?.trim().toLowerCase() : undefined;
  const revoke = argv.includes('--revoke');

  if (!email || email.startsWith('--')) {
    fail('Нужен --email. Пример: pnpm db:grant-platform -- --email owner@example.ru [--revoke]');
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, fullName: true } });

  if (!user) {
    fail(`Учётки ${email} нет. Сначала человек регистрируется на сайте.`);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { platformRole: revoke ? null : PlatformRole.OWNER },
  });

  console.log(
    revoke
      ? `${user.fullName} (${email}) больше не владелец платформы.`
      : `${user.fullName} (${email}) — владелец платформы. Сводка платформы пойдёт в MAX после его подключения в личном кабинете.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Команда не выполнена:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

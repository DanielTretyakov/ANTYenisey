/**
 * Заводит администратора или владельца клуба.
 *
 * Отдельной командой, а не сидом: сид лежит в репозитории, и пароль из него
 * попал бы в git вместе с историей. Здесь пароль приходит аргументом и нигде
 * не сохраняется.
 *
 * Запуск:
 *   pnpm db:create-admin -- --email a@club.ru --password "..." --name "Иванов Иван Иванович"
 *   pnpm db:create-admin -- --email o@club.ru --password "..." --name "..." --role OWNER
 *
 * Повторный запуск с тем же адресом меняет существующей учётке пароль, роль и
 * ФИО — так сбрасывают забытый пароль администратора, не заводя вторую учётку.
 */
import { PrismaClient, Role } from '@yenisey/database';
import { hashPassword } from '../src/auth/password.ts';

const prisma = new PrismaClient();

/** Разбор `--ключ значение`. Формат `--ключ=значение` тоже принимается. */
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token?.startsWith('--')) {
      continue;
    }

    const [key, inline] = token.slice(2).split('=', 2);

    if (!key) {
      continue;
    }

    if (inline !== undefined) {
      args[key] = inline;
      continue;
    }

    const next = argv[index + 1];

    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    }
  }

  return args;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const email = args.email?.trim().toLowerCase();
  const password = args.password;
  const fullName = args.name?.trim();
  const slug = args.club?.trim() ?? 'yenisey';
  const role = (args.role ?? 'ADMIN').toUpperCase();

  if (!email || !password || !fullName) {
    fail(
      'Нужны --email, --password и --name.\n' +
        'Пример: pnpm db:create-admin -- --email a@club.ru --password "..." --name "Иванов Иван Иванович"',
    );
  }

  if (role !== Role.ADMIN && role !== Role.OWNER) {
    fail(`Роль должна быть ADMIN или OWNER, получено «${role}»`);
  }

  // Порог тот же, что в форме регистрации: короткий пароль у администратора
  // опаснее, чем у клиента, а не безопаснее.
  if (password.length < 8) {
    fail('Пароль не короче 8 символов');
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });

  if (!tenant) {
    fail(`Клуб с кодом «${slug}» не найден. Сначала: pnpm db:seed`);
  }

  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email },
    select: { id: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      // Отметки деактивации снимаются намеренно: команда используется в том
      // числе чтобы вернуть доступ, и оставленный deactivatedAt тихо не пустил
      // бы человека войти со свежим паролем.
      data: { passwordHash, role, fullName, deactivatedAt: null, anonymizedAt: null },
    });

    console.log(`Учётка ${email} обновлена: роль ${role}, пароль заменён.`);
    return;
  }

  await prisma.user.create({
    data: { tenantId: tenant.id, email, passwordHash, role, fullName },
  });

  console.log(`Заведена учётка ${email} (${role}) в клубе «${tenant.name}».`);
}

main()
  .catch((error: unknown) => {
    console.error('Команда не выполнена:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

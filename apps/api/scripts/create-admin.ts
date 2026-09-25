/**
 * Заводит сотрудника клуба: администратора, владельца или тренера.
 *
 * Отдельной командой, а не сидом: сид лежит в репозитории, и пароль из него
 * попал бы в git вместе с историей. Здесь пароль приходит аргументом и нигде
 * не сохраняется.
 *
 * Запуск:
 *   pnpm db:create-admin -- --email a@club.ru --password "..." --name "Иванов Иван Иванович"
 *   pnpm db:create-admin -- --email o@club.ru --password "..." --name "..." --role OWNER
 *   pnpm db:create-admin -- --email t@club.ru --password "..." --name "..." --role COACH
 *
 * Необязательный --gender MALE|FEMALE — пол для заглушки аватара; без него у
 * учётки нейтральный силуэт, пока пол не укажут в кабинете.
 *
 * Повторный запуск с тем же адресом меняет существующей учётке пароль, роль и
 * ФИО — так сбрасывают забытый пароль администратора, не заводя вторую учётку.
 */
import { PrismaClient, Role } from '@yenisey/database';
import { parseBirthDate } from '../src/auth/birth-date.ts';
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
  // Телефон приходит как угодно — «8 (999) 123-45-67» тоже: чистим до цифр и
  // приводим к E.164, как это делает форма регистрации.
  const phone = normalisePhone(args.phone ?? '');
  const birthDate = parseBirthDate(args.birthdate?.trim() ?? '');
  const genderArg = args.gender?.trim().toUpperCase();
  const gender = genderArg === 'MALE' || genderArg === 'FEMALE' ? genderArg : undefined;

  if (genderArg && !gender) {
    fail(`Пол — MALE или FEMALE, получено «${args.gender}»`);
  }

  if (!email || !password || !fullName) {
    fail(
      'Нужны --email, --password и --name.\n' +
        'Пример: pnpm db:create-admin -- --email a@club.ru --password "..." --name "Иванов Иван Иванович"',
    );
  }

  // Телефон и дата рождения обязательны у всех ролей, а не только у клиента:
  // телефон — основной канал связи клуба, дата рождения нужна кадровому учёту.
  if (!phone) {
    fail('Нужен --phone в виде +79991234567');
  }

  if (!birthDate) {
    fail('Нужен --birthdate в виде 1985-03-12 — не в будущем и не раньше 1900 года');
  }

  if (role !== Role.ADMIN && role !== Role.OWNER && role !== Role.COACH) {
    fail(`Роль должна быть ADMIN, OWNER или COACH, получено «${role}»`);
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

  // Почта ищется по ВСЕЙ платформе, а не внутри клуба: аккаунт один, и
  // человек, уже играющий в соседнем клубе, не заводится заново — его
  // учётка привязывается к этому клубу с нужной ролью.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  const userId = existing
    ? (
        await prisma.user.update({
          where: { id: existing.id },
          // Отметки деактивации снимаются намеренно: команда используется в том
          // числе чтобы вернуть доступ, и оставленный deactivatedAt тихо не пустил
          // бы человека войти со свежим паролем.
          data: {
            passwordHash,
            fullName,
            phone,
            birthDate,
            ...(gender ? { gender } : {}),
            deactivatedAt: null,
            anonymizedAt: null,
          },
          select: { id: true },
        })
      ).id
    : (
        await prisma.user.create({
          data: { email, passwordHash, fullName, phone, birthDate, gender },
          select: { id: true },
        })
      ).id;

  // Роль — у привязки к клубу. Здесь же снимается клубное отключение: без
  // этого команда меняла бы пароль человеку, которого ClubContextGuard всё
  // равно не пустит в клуб.
  await prisma.tenantMembership.upsert({
    where: { userId_tenantId: { userId, tenantId: tenant.id } },
    update: { role, deactivatedAt: null },
    create: { userId, tenantId: tenant.id, role },
  });

  await ensureCoachProfile(userId, tenant.id, role);

  console.log(
    existing
      ? `Учётка ${email} привязана к клубу «${tenant.name}»: роль ${role}, пароль заменён.`
      : `Заведена учётка ${email} (${role}) в клубе «${tenant.name}».`,
  );
}

/** Телефон в E.164 или пустая строка, если из аргумента его не собрать. */
function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  // Номер с восьмёркой или семёркой в начале — это код страны, а не первая
  // цифра номера.
  const national = digits.length > 10 && /^[78]/.test(digits) ? digits.slice(1) : digits;

  return national.length === 10 ? `+7${national}` : '';
}

/**
 * Тренеру нужен CoachProfile.
 *
 * Без него учётка с ролью COACH — это тренер, которого нельзя ни назначить на
 * тренировку, ни показать на публичной странице: и то, и другое ссылается на
 * профиль, а не на пользователя. Карточка при этом остаётся пустой — фото,
 * достижения и контакты тренер заполняет сам.
 */
async function ensureCoachProfile(userId: string, tenantId: string, role: string): Promise<void> {
  if (role !== Role.COACH) {
    return;
  }

  await prisma.coachProfile.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    update: {},
    create: { userId, tenantId },
  });
}

main()
  .catch((error: unknown) => {
    console.error('Команда не выполнена:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
